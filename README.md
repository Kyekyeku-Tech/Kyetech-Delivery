# KyeTech Delivery

A simple React.js delivery platform for Sekondi–Takoradi, using Firebase Authentication and Cloud Firestore. Customer and rider screens follow the supplied mobile designs. The merchant workspace uses the same style pending its final reference.

## Run locally

Use Node.js 24. The project's [package.json](./package.json) pins Vercel builds and API functions to `24.x`, matching the tested local runtime.

Vercel's function loader can reject CommonJS `require()` of ESM even on Node 24. Firebase Admin's `jwks-rsa` 4 dependency requires `jose` at startup; [package.json](./package.json) overrides that dependency to the CommonJS-compatible `jose` 5.10.0. Keep [package-lock.json](./package-lock.json) in deployments so the resolved dependency matches the fix. Remove the override only after the upstream dependency supports this loader and the restricted-runtime tests pass. `npm test` disables experimental CommonJS loading of ESM to reproduce the deployed loader's restriction, including API startup and RSA signing-key verification checks. [.vercelignore](./.vercelignore) excludes local credentials, delivery data and verification folders from CLI uploads; configure runtime credentials through Vercel environment variables.

```sh
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` creates the deployable application in `dist`. `npm test` checks delivery validation, GPS, SMS, catalog, team workspaces, reviews and the supplied motorcycle assets.

The app uses `public/images/logo.png` for its branding, with resized PNG copies for browser and mobile icons. Startup and workspace loading panels use animated delivery graphics and respect reduced-motion settings. If a data listener was denied before a rules update, **Retry connection** reconnects failed reads while keeping the active page open; returning to the page or reconnecting to the internet also retries them.

For the branded password-reset email, copy [templates/password-reset.html](./templates/password-reset.html) into Firebase Authentication → Templates → Password reset → Email body. Suggested subject: `Reset your %APP_NAME% password`. The HTML retains Firebase's `%APP_NAME%`, `%EMAIL%` and `%LINK%` placeholders and uses the supplied hosted logo. Saving the file locally does not update the Firebase email template.

## Install on a phone

Open **https://kyetechdelivery.site** on your phone. The **Install app** option appears on the sign-in page and in **Profile**. On Android, Chrome and Edge offer the native installation prompt; if it is unavailable, the option explains how to install from the browser menu. On iPhone or iPad, open the site in Safari and choose **Share → Add to Home Screen → Add**, keeping **Open as Web App** enabled if shown.

The installed app opens in its own window with the KyeTech icon. Deliveries, live tracking and account verification require an internet connection. Opening the app offline shows a reconnect screen. The service worker caches public app files and icons; authenticated API requests and Firebase account/delivery data use the network. App updates wait until existing app windows close so active deliveries and verification are not interrupted.

`npm run build` emits the versioned root service worker automatically. HTTPS hosting is required for installation (localhost is supported for development checks). The manifest, Apple touch icon and deployment headers are included in the repository.

## Activate Firebase

The existing `.env` names `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` and `NEXT_PUBLIC_FIREBASE_APP_ID` are supported. Equivalent `VITE_FIREBASE_*` names also work. Restart the dev server after editing these values.

1. In Firebase Authentication, enable the **Email/Password** sign-in provider.
2. Create the default **Cloud Firestore** database.
3. Open Firestore → **Rules**, paste [firestore.rules](./firestore.rules), and publish. The app requires these rules before account registration. Alternatively, deploy them with Firebase CLI as shown below.
4. Add `localhost` and your deployed domain in Authentication → Settings → Authorized domains if missing.
5. Create separate customer, rider and merchant accounts. Riders save their bike brand, model and plate in Profile before going online. Merchants set up their store before dispatching.

Firebase Storage is unnecessary. Photos are public image URLs; rider models and brand logos use [public/images](./public/images). Firebase web config is public by design. Administrator email verification uses a server-only Firebase service credential, as described below. Private service credentials are never mapped into the browser bundle.

## Administrator email OTP

Enabled administrators sign in with their existing Firebase email/password account, then receive a fresh MojoAuth email code. The administrator workspace and privileged database operations remain locked until the code is verified. Customers, merchants and riders keep their existing sign-in flow. A verified administrator session lasts up to eight hours across reloads; a new password sign-in requires a new code, and signing out revokes that session.

The server sends only to the authenticated administrator's Firebase account email. Codes expire after ten minutes, resends have a one-minute cooldown, and five incorrect attempts exhaust a challenge. OTP grants use a signed, session-specific Firebase custom-token claim and a server-created Firestore record. Browser clients cannot create or extend grants, and disabling the administrator or account removes access.

Configure these server-only variables in local `.env` and Vercel:

- `MOJOAUTH_API_KEY`: copy the credential labelled **API Key** or **API Key / Client ID** from the MojoAuth project's API credentials. A separate OAuth Client Secret is not needed for email OTP.
- `FIREBASE_SERVICE_ACCOUNT_JSON`: the complete Firebase Admin SDK service-account JSON for this Firebase project. Obtain it from Firebase Console → Project settings → Service accounts → Firebase Admin SDK → Generate new private key. Application Default Credentials can be used instead on a server with the required Firestore and Firebase Authentication permissions.

In `.env`, wrap the complete JSON in single quotes so multiline content is parsed correctly. In Vercel's environment-variable value field, paste the JSON itself, without the variable name or outer `.env` quotes. Keep the file and credential values private.

The `/api/admin-otp` route runs in Vite, the standalone Node server and Vercel. Set both Vercel environment variables, redeploy the application and API, then publish the current [firestore.rules](./firestore.rules) and sign in again. Publishing the rules without the configured OTP route will lock administrator operations until verification is available. The Firebase rules enforce the grant independently of the page, and administrator delivery SMS requires the same verified session.

For the production domain, add `kyetechdelivery.site` (and `www.kyetechdelivery.site` if used) to Firebase Authentication → Settings → Authorized domains. Set `MOJOAUTH_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON` and your Firebase web project configuration in Vercel's **Production** environment, then redeploy. Local environment variables do not automatically become Vercel runtime variables.

If Vercel returns `FUNCTION_INVOCATION_FAILED` for the OTP route, the API crashed before it could return its normal JSON error. Open the project's runtime **Logs** and filter by `/api/admin-otp`; this is a server deployment failure. [vercel.json](./vercel.json) explicitly includes the server modules and their shared helpers in all three API functions. Deploy the current repository from its root using the Vite framework preset, and confirm Node.js **24.x** under Settings → Build and Deployment.

After redeploying, run the startup checks from [scripts/check-deployment.mjs](./scripts/check-deployment.mjs):

```sh
npm run check:deployment
# Or check the original Vercel deployment address:
npm run check:deployment -- https://YOUR_PROJECT.vercel.app
```

These checks verify that OTP, GPS and SMS functions load and return JSON while rejecting unauthenticated or invalid requests. They do not send email or SMS or validate the provider credentials. Once the checks pass, sign in as an enabled administrator and verify receipt of the email code. The visual fixture in [.verification/admin-otp/check.mjs](./.verification/admin-otp/check.mjs) replaces the OTP provider and blocks live API requests, so it cannot verify production connectivity or email delivery.

## Delivery operation

Customers can find stores, call to arrange purchases, and request a delivery. Merchants can register their storefront and dispatch packages directly. A proposed delivery fee is entered in GHS (minimum GH₵15, configurable in the domain module and security rules).

Online riders see incoming requests. They accept a booking, confirm pickup, then confirm delivery. Updates appear in the sender’s account in real time. Acceptance and cancellation use Firestore transactions to avoid overwriting another rider’s claim. Pending requests can be cancelled by their sender. Completed trips allow each party one rating.

The rider **Dispatch feed** displays incoming, active and completed deliveries as compact rows with order ID, status and **View**. Open **View** for pickup/drop-off, package, agreed fee, sender and recipient details, plus the relevant acceptance, call, directions, pickup, completion, rating and live GPS controls. Selected GPS sharing continues when the details dialog closes, while the rider keeps the page open.

Merchant **Your deliveries** and dashboard **Latest deliveries** use the same compact records. **View** opens full delivery details, recipient/rider calling and live tracking. Owners and accepted team members can request deliveries, cancel pending requests and rate the rider once after completion. The sender rating belongs to the store and is separate from the recipient's review.

When requesting a delivery, customers can search **Pickup store (optional)** by name, area or category and select an approved, active, open platform store to fill in the pickup address. The selector supports keyboard navigation, keeps the current pickup until another choice is made, and includes **Enter a pickup address** for manual locations. **Find a store** includes category and open-status filters; **Find a rider** supports name, area and motorcycle search with an online filter. Both directories include call and delivery request buttons.

**Use my current location** requests location access when clicked and automatically fills the drop-off with a readable GPS address (street, area, town, region and country where available). The exact coordinates are saved separately so rider directions still use the detected pin. Location detection requires HTTPS (or localhost) and browser permission; customers can type an address instead.

Merchant store setup includes photo upload with preview/progress and an optional GPS pickup pin captured while the merchant is at the store. Capturing the pin also fills the store address and shows its GPS address details. Merchants can edit the written address to add a landmark. New delivery requests copy the pin into the booking so rider pickup directions retain the original location. Existing stores and bookings without a pin use their written address. Capture a new pin when the store moves.

The authenticated `/api/gps-address` route looks up addresses with OpenStreetMap Nominatim, caches nearby results and limits upstream request frequency. It runs in Vite, the standalone Node server and [api/gps-address.js](./api/gps-address.js) on Vercel, using the existing Firebase project configuration. It needs no additional map API key. If the address service is unavailable, the captured GPS pin remains usable and the form prompts for a written address or landmark.

Assigned riders can choose **Share live location** during active deliveries. Customers and merchants see a map, GPS address, accuracy and update time on the delivery card. Positions update approximately every 15 seconds while the rider keeps the page open and permits location access. Old positions are labelled as the last shared location, rather than live. **Stop sharing**, signing out and completing all active deliveries end sharing. Completing, cancelling or reassigning a booking removes its tracking record. Tracking documents are private to the active booking's sender, assigned rider and authorised store team.

## Merchant store team

The merchant dashboard starts with the store name and delivery activity. Store owners can open **My store → Your store team**, enter a team member's email and select **Add team member**. This saves an invitation inside the platform; the owner should ask the member to sign up or sign in as a merchant with that email. The member verifies their email using the verification button, then accepts the invitation. Their invited store opens automatically and remains the default on reload, without a workspace chooser or a separate personal-store option.

Accepted team members can add, edit and remove products/menu listings; request and cancel pending store deliveries; rate completed delivery riders; and see store SMS copies, details, live rider updates and recipient feedback. New deliveries use the invited store's identity and pickup phone, while recording the signed-in member as `createdBy`. Only the store owner can edit store settings, change opening status or invite/remove members. Customer bookings from the store directory remain private to those customers. **Remove access** revokes team permissions. Publish the updated rules for the private `storeInvites` and `storeMembers` collections before using the team flow; no Firebase service account or separate backend account management is needed.

## Store products and menu

Merchants open **Products** to add a product or menu item with a name, category, description, GHS price, photo and availability. Owners and accepted team members can edit or remove listings and mark items unavailable when they are out of stock or off the menu. Listings are saved under `stores/{storeId}/listings/{listingId}`; publish the current [firestore.rules](./firestore.rules) before using them.

Customers open **Find a store → Products & menu** to search available listings by name, category or type. They can call the store to arrange the items and payment, then request a delivery. Selecting an item fills the pickup store and package description; the item price and delivery fee are separate. Closed stores can be browsed, with delivery requests disabled. Unavailable items and unapproved or suspended stores are hidden from customer browsing.

## Delivery SMS updates

mNotify sends an SMS from **KYE-TECH** after an assigned rider or administrator confirms pickup or completes a customer or merchant delivery. Customer bookings send to the booking customer's saved phone number, and completion messages link directly to that account’s rider rating screen. Merchant bookings send to the saved delivery recipient’s phone number; the completion SMS includes a private link to rate both the rider and the merchant store without signing in.

The customer portal's **SMS** tab shows saved copies of messages accepted by mNotify. Customers can filter by pickup/completion and an inclusive date range, copy message text, and rate an unrated completed delivery. Each account can only read its own submitted messages; provider acceptance does not confirm delivery to the phone. Existing notification records without a saved message body do not appear in the inbox.

The merchant **SMS** tab shows copies sent for the current store’s merchant deliveries. Owners and accepted team members can view and copy them, filter by pickup/completion or date, and see red unread counts before the Profile button. Viewed status is private to each signed-in account and uses the same browser storage and Firestore receipts as customer SMS. A change in accessible store resets filters and closes any open message. Merchant messages use `merchantId` metadata; existing customer messages without this field remain compatible. Earlier merchant deliveries without saved SMS records are not backfilled or resent.

Recipient rating links expire after 30 days and accept one review per delivery. Both ratings must be selected; a written comment is optional. The review and consumption of its link are saved together, preventing duplicate reviews. Invite records expose only display names, the delivery reference and review authorization, without phone numbers or addresses. Store owners and accepted team members see recipient feedback in **My store**; riders see their recipient ratings in **Performance**. Publish the current rules for `deliveryReviewLinks` and `deliveryReviews`, and redeploy Vercel so completion SMS uses the new `/review` page.

Unopened SMS messages show red counts on the SMS button and message rows. Opening a message saves its viewed ID in browser storage for the signed-in account and syncs a private receipt to `users/{uid}/smsReads/{notificationId}`. Browser storage contains IDs only; accounts and Firebase projects have separate keys. Viewed messages remain viewed on this browser after reload even if Firestore is offline or its receipt rules are missing. Pending receipts retry when the page regains focus or connectivity, and published receipt rules enable synchronisation across devices. Publish the current [firestore.rules](./firestore.rules) in Firebase Console → Firestore Database → Rules; redeploying Vercel alone does not update Firestore rules. An error appears only when neither browser storage nor Firestore can save the viewed status.

Save `VITE_MNOTIFY_API_KEY` in the root `.env`, and set `SMS_APP_URL` to your public HTTPS website (default: `https://kyetechdelivery.site`). The key is read by the Node server and excluded from the browser environment. `npm run check:sms` checks the key, balance and sender approval without sending messages.

The SMS route runs with `npm run dev`. To host the application with SMS enabled, build it and run the Node server:

```sh
npm run build
npm start
```

The server defaults to port 8085; set `PORT` as needed. Host it behind HTTPS, or proxy `/api/delivery-sms` from your existing website to this server. Static Firebase Hosting alone cannot run this route. This integration uses Firebase Authentication and the existing Firestore database to verify the rider and delivery; Firebase Cloud Functions and a Blaze upgrade are unnecessary.

For Vercel, [api/delivery-sms.js](./api/delivery-sms.js) is the serverless SMS route. Set `VITE_MNOTIFY_API_KEY` and your Firebase web project ID in the Vercel project's environment variables, and optionally set `SMS_APP_URL` to the public website. Redeploy after adding environment variables. [vercel.json](./vercel.json) configures Vite, the API functions and the admin URL. Publish [firestore.rules](./firestore.rules): Vercel stores notification records in the private `deliverySms` collection. The SMS route uses the signed-in operator's Firebase token to verify the delivery and reserve a single notification. Assigned riders need no service-account credential for this route; administrator OTP is configured separately above. Cloud Functions are unnecessary.

Local development, the standalone Node server, and Vercel all store message copies and duplicate protection in Firestore's `deliverySms` collection. Publish the current rules before using any of these routes. Records keep one notification per delivery stage to prevent duplicate submissions. Rejected or uncertain submissions are recorded for operator review; uncertain outcomes are not automatically resent. An SMS failure leaves the confirmed delivery status saved and prompts the operator to call the customer.

Delivery fees are paid directly in cash. Rider earnings show the agreed fees recorded on completed trips; the app does not process Paystack/MoMo payments or withdrawals. Directions open Google Maps; live rider positions use an OpenStreetMap map. Live sharing requires an open browser page and is not background tracking. Customers select a rider or send to the available queue.

Feedback is saved to the `feedback` collection. The service operator can read it in the Firebase console. Account roles cannot be changed from the browser. Store and rider service-contact information is visible to signed-in users; private user documents and delivery history are restricted by role and ownership. All self-registered rider accounts can see the pending dispatch queue, so operate rider onboarding according to your service’s vetting process.

## Deploy when ready

Install Firebase CLI, sign in, and replace `YOUR_PROJECT_ID` below with the Firebase project ID from your configuration:

```sh
npm run build
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules,hosting --project YOUR_PROJECT_ID
```

[firebase.json](./firebase.json) includes Firebase Hosting configuration and the single-page application rewrite. Deployment is an explicit operator step; creating the app does not publish it.

## Local Firebase testing

The Firebase Emulator Suite can test accounts and rules without touching the live service. It requires Java 21+ for the Firestore emulator and Firebase CLI. Set `VITE_USE_FIREBASE_EMULATORS=true` in `.env.local`, use a demo project configuration, then restart Vite. Run:

```sh
npx firebase-tools emulators:start --only auth,firestore --project demo-kyetech
```

Keep emulator mode off when serving real customers. Before opening the service, verify a complete delivery across customer, rider and merchant accounts on your chosen Firebase project.
