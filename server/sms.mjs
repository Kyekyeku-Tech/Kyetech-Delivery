import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { mkdir, open, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { deliverySmsForChange, processDeliverySms } from './deliverySms.mjs';
import { sendQuickSms } from './mnotify.mjs';

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function decodeDocument(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key,
    value.stringValue ?? value.booleanValue ?? (value.integerValue === undefined ? undefined : Number(value.integerValue)) ?? value.doubleValue ?? value.timestampValue ?? (value.nullValue === null ? null : undefined),
  ]));
}

async function verifyToken(token, projectId) {
  const name = 'kyetech-sms-auth';
  const app = getApps().find(candidate => candidate.name === name) || initializeApp({ projectId }, name);
  try { return await getAuth(app).verifyIdToken(token); }
  catch { throw new RequestError(401, 'Sign in again to send delivery updates.'); }
}

async function readDocument(path, token, projectId) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new RequestError(response.status === 403 ? 403 : 503, 'The delivery could not be verified.');
  return decodeDocument((await response.json()).fields);
}

export function createSmsService({ projectId, apiKey, appUrl = 'https://kyetechdelivery.site', outboxDir = resolve('.data/sms'), storeFactory, verify = verifyToken, read = readDocument, send = sendQuickSms }) {
  return async ({ token, orderId, status }) => {
    if (!token) throw new RequestError(401, 'Sign in to send delivery updates.');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(orderId || '') || !['picked_up', 'delivered'].includes(status)) throw new RequestError(400, 'Choose a valid delivery update.');
    if (!projectId || !apiKey?.trim()) throw new RequestError(503, 'SMS updates are not configured.');
    const account = await verify(token, projectId);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(account.uid || '')) throw new RequestError(401, 'Sign in again to send delivery updates.');
    const checks = await Promise.allSettled([
      read(`users/${account.uid}`, token, projectId),
      read(`admins/${account.uid}`, token, projectId),
      read(`orders/${orderId}`, token, projectId),
    ]);
    for (const result of checks) if (result.status === 'rejected') throw result.reason;
    const [profile, admin, order] = checks.map(result => result.value);
    const active = profile && (profile.accountStatus || 'active') === 'active';
    const rider = active && profile.role === 'rider' && profile.approvalStatus === 'approved' && order?.riderId === account.uid;
    let verifiedAdmin = false;
    const sessionId = account.adminOtpSessionId;
    if (!rider && admin?.enabled === true && /^[a-f0-9]{64}$/.test(sessionId || '') && account.firebase?.sign_in_provider === 'custom' && Number.isInteger(account.auth_time)) {
      let grant;
      try { grant = await read(`adminOtpSessions/${sessionId}`, token, projectId); } catch {}
      verifiedAdmin = grant?.uid === account.uid && grant.status === 'active' && grant.authTime === account.auth_time && new Date(grant.expiresAt).getTime() > Date.now();
    }
    if (!active || (!rider && !verifiedAdmin)) throw new RequestError(403, 'Only the assigned rider or an email-verified administrator can send this update.');
    if (!order || order.status !== status) throw new RequestError(409, 'The delivery status has changed.');
    let merchantName;
    if (order.creatorRole === 'merchant' && status === 'delivered') {
      // Store display metadata is optional; access failure must not stop a valid delivery update.
      try { merchantName = (await read(`stores/${order.creatorId}`, token, projectId))?.name; } catch {}
    }
    const job = deliverySmsForChange({ orderId, before: { status: status === 'picked_up' ? 'accepted' : 'picked_up' }, after: order, appUrl, merchantName });
    if (!job) return { status: 'skipped' };
    if (job.reviewInvite && !storeFactory) throw new RequestError(503, 'Recipient review links require the delivery SMS database.');
    if (storeFactory) {
      const store = storeFactory({ job, projectId, token, actorId: account.uid });
      const outcome = await processDeliverySms({
        claim: () => store.claim(), save: patch => store.save(patch),
        send: message => send({ apiKey, recipient: message.recipient, message: message.message }),
      });
      return { status: store.existingStatus || outcome };
    }
    await mkdir(outboxDir, { recursive: true });
    const file = resolve(outboxDir, `${job.id}.json`);
    let existing;
    const outcome = await processDeliverySms({
      claim: async () => {
        let handle;
        try { handle = await open(file, 'wx', 0o600); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          try { existing = JSON.parse(await readFile(file, 'utf8')).status; }
          catch { existing = 'submitting'; }
          return null;
        }
        try { await handle.writeFile(JSON.stringify({ ...job, status: 'submitting', attemptedAt: new Date().toISOString() })); }
        finally { await handle.close(); }
        return job;
      },
      send: message => send({ apiKey, recipient: message.recipient, message: message.message }),
      save: async patch => {
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify({ ...job, ...patch, processedAt: new Date().toISOString() }), { mode: 0o600 });
        await rename(temporary, file);
      },
    });
    return { status: existing || outcome };
  };
}

export function createDeliverySmsMiddleware(options) {
  const notify = createSmsService(options);
  return async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); throw new RequestError(405, 'Use POST for delivery updates.'); }
      if (!request.headers['content-type']?.startsWith('application/json')) throw new RequestError(415, 'Send the delivery update as JSON.');
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw new RequestError(403, 'Use the delivery app to send this update.');
      const token = request.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!token) throw new RequestError(401, 'Sign in to send delivery updates.');
      let data;
      if (request.body !== undefined && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) data = request.body;
      else {
        let body = typeof request.body === 'string' || Buffer.isBuffer(request.body) ? String(request.body) : '';
        if (request.body === undefined) for await (const chunk of request) {
          body += chunk.toString('utf8');
          if (Buffer.byteLength(body) > 4096) throw new RequestError(413, 'The delivery update is too large.');
        }
        if (Buffer.byteLength(body) > 4096) throw new RequestError(413, 'The delivery update is too large.');
        try { data = JSON.parse(body); } catch { throw new RequestError(400, 'Send a valid delivery update.'); }
      }
      if (!data || Array.isArray(data) || Object.keys(data).some(key => !['orderId', 'status'].includes(key))) throw new RequestError(400, 'Send only the delivery ID and status.');
      const result = await notify({ token, orderId: data.orderId, status: data.status });
      response.statusCode = 200;
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = error instanceof RequestError ? error.status : 503;
      response.end(JSON.stringify({ status: 'unavailable', message: error instanceof RequestError ? error.message : 'SMS update could not be sent.' }));
    }
  };
}
