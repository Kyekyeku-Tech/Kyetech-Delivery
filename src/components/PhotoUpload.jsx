import { useEffect, useId, useRef, useState } from 'react';
import { Avatar, Button, Icon, SafeImage } from './UI';
import { IMAGE_ACCEPT, uploadImageToImgbb, validateImageFile } from '../lib/imageUpload';
import '../upload.css';

export default function PhotoUpload({ value = '', onChange, onUploadingChange, disabled = false, label = 'Profile photo', name = '', kind = 'profile' }) {
  const inputId = useId();
  const errorId = useId();
  const fileInput = useRef(null);
  const lastFile = useRef(null);
  const controller = useRef(null);
  const previewUrl = useRef('');
  const mounted = useRef(false);
  const operation = useRef(0);
  const callbacks = useRef({ onChange, onUploadingChange });
  callbacks.current = { onChange, onUploadingChange };
  const [preview, setPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function clearPreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = '';
    if (mounted.current) setPreview('');
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current += 1;
      controller.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = '';
      callbacks.current.onUploadingChange?.(false);
    };
  }, []);

  async function upload(file) {
    if (disabled || uploading || controller.current) return;
    setError(''); setNotice('');
    try { validateImageFile(file); }
    catch (cause) { lastFile.current = null; setError(cause.message); return; }
    lastFile.current = file;
    clearPreview();
    previewUrl.current = URL.createObjectURL(file);
    setPreview(previewUrl.current);
    const currentOperation = ++operation.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setUploading(true); setProgress(0);
    callbacks.current.onUploadingChange?.(true);
    try {
      const url = await uploadImageToImgbb(file, percentage => {
        if (mounted.current && operation.current === currentOperation) setProgress(percentage);
      }, { signal: nextController.signal });
      if (!mounted.current || operation.current !== currentOperation) return;
      callbacks.current.onChange?.(url);
      lastFile.current = null;
      setNotice('Photo uploaded. Save your changes to use it.');
    } catch (cause) {
      if (!mounted.current || operation.current !== currentOperation) return;
      if (cause.name === 'AbortError') setNotice('Upload cancelled. Choose a photo when you are ready.');
      else setError(cause.message);
    } finally {
      if (mounted.current && operation.current === currentOperation) {
        clearPreview();
        controller.current = null;
        setUploading(false);
        callbacks.current.onUploadingChange?.(false);
      }
    }
  }

  function changeUrl(event) {
    clearPreview(); lastFile.current = null;
    setError(''); setNotice('');
    callbacks.current.onChange?.(event.target.value);
  }

  return <div className={'photo-upload photo-upload-' + kind}>
    <div className="photo-upload-header">
      <div className="photo-upload-preview">
        {kind === 'store'
          ? <SafeImage src={preview || value} alt={label + ' preview'} className="photo-upload-store-image" />
          : <Avatar name={name} src={preview || value} size={88} />}
      </div>
      <div className="photo-upload-controls">
        <span className="field-label">{label}</span>
        <p className="photo-upload-hint">Choose a JPG, PNG, WebP or GIF up to 10 MB.</p>
        <div className="photo-upload-actions">
          <Button variant="secondary" disabled={disabled || uploading} onClick={() => fileInput.current?.click()}>
            <Icon name="plus" size={18} />{value ? 'Change photo' : 'Upload photo'}
          </Button>
          {uploading && <Button variant="ghost" onClick={() => controller.current?.abort()}>Cancel</Button>}
          {!uploading && value && <Button variant="ghost" disabled={disabled} onClick={() => {
            clearPreview(); lastFile.current = null; setError(''); setNotice(''); callbacks.current.onChange?.('');
          }}>Remove</Button>}
        </div>
        <input id={inputId} ref={fileInput} className="photo-upload-input" type="file" accept={IMAGE_ACCEPT}
          aria-label={'Upload ' + label.toLowerCase()} aria-describedby={error ? errorId : undefined}
          disabled={disabled || uploading} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) upload(file);
          }} />
      </div>
    </div>
    {uploading && <div className="photo-upload-progress" role="status" aria-live="polite">
      <div className="photo-upload-progress-label"><span>{progress < 100 ? 'Uploading photo…' : 'Finishing upload…'}</span><strong>{progress}%</strong></div>
      <progress max="100" value={progress} aria-label="Photo upload progress" />
    </div>}
    {error && <div className="photo-upload-error">
      <p className="form-error" id={errorId} role="alert">{error}</p>
      {lastFile.current && <Button variant="ghost" disabled={disabled || uploading} onClick={() => upload(lastFile.current)}>Retry upload</Button>}
    </div>}
    {notice && <p className="photo-upload-notice" role="status">{notice}</p>}
    <details className="photo-upload-link">
      <summary>Use an image link instead</summary>
      <label className="field"><span className="field-label">Image URL (optional)</span>
        <input type="text" inputMode="url" value={value} onChange={changeUrl} disabled={disabled || uploading} maxLength={2000} placeholder="https://example.com/photo.jpg" />
      </label>
    </details>
  </div>;
}
