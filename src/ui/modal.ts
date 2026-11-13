/**
 * Basit modal: yıl sonu özeti gibi bilgiler.
 */
export function showModal(title: string, html: string, onClose?: () => void): void {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
      <h2>${title}</h2>
      <div class="modal-body">${html}</div>
      <button type="button" class="modal-ok">Devam</button>
    </div>`;
  const close = () => {
    back.remove();
    onClose?.();
  };
  back.querySelector('.modal-ok')!.addEventListener('click', close);
  back.addEventListener('click', (ev) => {
    if (ev.target === back) close();
  });
  document.body.append(back);
  (back.querySelector('.modal-ok') as HTMLButtonElement).focus();
}
