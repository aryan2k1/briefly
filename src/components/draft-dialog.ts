/** HTML confirmation remains inspectable in browsers that suppress window.confirm. */
export function showDraftDialog(saving = false): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const dialog = document.createElement("dialog");
    dialog.className = "draft-dialog";
    dialog.setAttribute("aria-labelledby", "draft-dialog-title");
    dialog.setAttribute("aria-describedby", "draft-dialog-description");
    const title = document.createElement("h2");
    title.id = "draft-dialog-title";
    title.textContent = saving
      ? "Meeting is saving"
      : "Discard unsaved changes?";
    const description = document.createElement("p");
    description.id = "draft-dialog-description";
    description.textContent = saving
      ? "Wait for the save to finish before leaving this meeting."
      : "Your meeting draft has not been saved. Stay to keep editing, or discard it to continue.";
    const stay = document.createElement("button");
    stay.className = "secondary";
    stay.textContent = saving ? "Keep waiting" : "Stay and keep editing";
    const finish = (discard: boolean) => {
      dialog.close();
      dialog.remove();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
      resolve(discard);
    };
    stay.addEventListener("click", () => finish(false));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.append(title, description, stay);
    if (!saving) {
      const discard = document.createElement("button");
      discard.className = "primary";
      discard.textContent = "Discard changes and continue";
      discard.addEventListener("click", () => finish(true));
      dialog.append(discard);
    }
    document.body.append(dialog);
    dialog.showModal();
    stay.focus();
  });
}
