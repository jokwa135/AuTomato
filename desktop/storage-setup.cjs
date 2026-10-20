const api = window.automato;
const $ = selector => document.querySelector(selector);
let selected, original, recovery;
api.storageInfo().then(info => {
  selected = info.dataDir; $('#setupPath').textContent = selected;
  original = selected; recovery = info.recovery;
  if (info.hasExistingData) $('#setupNote').textContent = 'Your existing workspace was found here. Keep it, or select an empty folder to copy it into. The original is preserved.';
  if (recovery) {
    document.title = 'AuTomato Storage Recovery'; $('#setupTitle').textContent = 'Your workspace is still safe.';
    $('#setupIntro').textContent = 'Let’s get you back to work.';
    $('#setupNote').textContent = recovery.message;
    $('#setupRetry').hidden = recovery.kind !== 'transfer' || !recovery.retryable;
    if (recovery.kind === 'transfer') $('#setupContinue').textContent = 'Use original folder';
    if (recovery.kind === 'override') { $('#setupChoose').disabled = true; $('#setupContinue').disabled = true; }
  }
}).catch(error => { $('#setupStatus').textContent = error.message; });
$('#setupChoose').onclick = async () => {
  try { const folder = await api.chooseStorage(); if (folder) { selected = folder; $('#setupPath').textContent = folder; $('#setupStatus').textContent = ''; $('#setupContinue').textContent = recovery?.kind === 'transfer' && folder === original ? 'Use original folder' : 'Use this folder'; } }
  catch (error) { $('#setupStatus').textContent = error.message; }
};
$('#setupContinue').onclick = async () => {
  $('#setupContinue').disabled = true;
  try { $('#setupStatus').textContent = 'Opening your workspace…'; await api.saveStorage(selected); }
  catch (error) { $('#setupStatus').textContent = error.message; $('#setupContinue').disabled = false; }
};
$('#setupClose').onclick = () => close();
$('#setupRetry').onclick = async () => {
  $('#setupRetry').disabled = true; $('#setupContinue').disabled = true;
  try { $('#setupStatus').textContent = 'Retrying after restart…'; await api.retryStorage(); }
  catch (error) { $('#setupStatus').textContent = error.message; $('#setupRetry').disabled = false; $('#setupContinue').disabled = false; }
};
