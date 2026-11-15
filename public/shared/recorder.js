export async function listInputDevices() {
  await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => stream.getTracks().forEach(track => track.stop()));
  return (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');
}
export async function createRecorder({ deviceId } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
  const recorder = new MediaRecorder(stream); const chunks = [];
  recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
  return { start() { chunks.length = 0; recorder.start(); }, stop() { return new Promise((resolve, reject) => { recorder.addEventListener('stop', () => { stream.getTracks().forEach(track => track.stop()); resolve(new Blob(chunks, { type: recorder.mimeType })); }, { once: true }); recorder.addEventListener('error', reject, { once: true }); recorder.stop(); }); } };
}
