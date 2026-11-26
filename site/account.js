// The Account page: make an account key, sign in with one on another device, sign out or delete.
// The syncing itself lives in common.js (UI.Account), so it runs on every page.
(function () {
  const { esc, Account } = UI;
  const $ = (id) => document.getElementById(id);
  $("updated").textContent = "";
  const box = $("acct");

  function when(iso) { return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "not yet"; }

  function render(msg) {
    if (!(window.Live && Live.on)) {
      box.innerHTML = `<div class="empty">Accounts need the site's live service, which isn't switched on yet. Your data stays in this browser for now.</div>`;
      return;
    }
    const key = Account.key(), st = Account.status();
    if (key) {
      box.innerHTML = `<h2>Signed in on this device</h2>
        <p>Your account key:</p>
        <div class="acct-key"><code id="key" class="num">${esc(key)}</code><button class="btn small" id="copy" type="button">Copy</button><button class="btn small" id="show" type="button">Hide</button></div>
        <p class="hint">Enter this key on the Account page of any other device to sync it. Anyone with the key can see and change your saved data, so don't share it.</p>
        <p class="acct-status">Last synced: <b>${esc(when(st.at))}</b>${st.items != null ? ` · ${st.items} items saved` : ""}${st.error ? `<br><span class="down">Last try failed: ${esc(st.error)}</span>` : ""}</p>
        ${msg ? `<p class="acct-msg">${msg}</p>` : ""}
        <div class="acct-actions">
          <button class="btn primary" id="sync" type="button">Sync now</button>
          <button class="btn" id="out" type="button">Sign out of this device</button>
          <button class="btn danger" id="del" type="button">Delete account</button>
        </div>`;
      $("copy").onclick = async () => { try { await navigator.clipboard.writeText(key); $("copy").textContent = "Copied ✓"; } catch { $("copy").textContent = "Copy failed"; } };
      $("show").onclick = () => { const k = $("key"); const hid = k.dataset.hid === "1"; k.textContent = hid ? key : "••••-••••-••••-••••-••••"; k.dataset.hid = hid ? "0" : "1"; $("show").textContent = hid ? "Hide" : "Show"; };
      $("sync").onclick = async () => {
        $("sync").disabled = true;
        try { const n = await Account.sync(); render(n ? `Brought in ${n} changed item${n === 1 ? "" : "s"} from your other devices.` : "Everything is up to date."); }
        catch (e) { render(`<span class="down">${esc(e.message)}</span>`); }
      };
      $("out").onclick = () => {
        if (!confirm("Sign out on this device? Your data stays in your account and in this browser, but stops syncing here.")) return;
        Account.signOut(); render("Signed out on this device.");
      };
      $("del").onclick = async () => {
        if (!confirm("Delete your account? Everything saved in it is erased for good. Data already in each browser stays there.")) return;
        try { await Account.remove(); render("Your account was deleted."); } catch (e) { render(`<span class="down">${esc(e.message)}</span>`); }
      };
      return;
    }
    box.innerHTML = `<div class="acct-two">
        <div>
          <h2>New here?</h2>
          <p>Make a free account to back up what you've saved in this browser and use it on your other devices.</p>
          <button class="btn primary" id="make" type="button">Make my free account</button>
        </div>
        <form id="in-form">
          <h2>Have a key?</h2>
          <p>Enter the account key from your other device. What's saved in your account replaces what's in this browser.</p>
          <input class="field" id="in-key" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" aria-label="Account key" maxlength="29">
          <button class="btn" id="in" type="submit">Sign in</button>
        </form>
      </div>
      ${msg ? `<p class="acct-msg">${msg}</p>` : ""}`;
    $("make").onclick = async () => {
      $("make").disabled = true;
      try { await Account.create(); render("Your account is ready. <b>Copy your key and keep it somewhere safe</b>: it's the only way to sign in on another device, and it can't be recovered if lost."); }
      catch (e) { render(`<span class="down">${esc(e.message)}</span>`); }
    };
    $("in-form").onsubmit = async (e) => {
      e.preventDefault();
      $("in").disabled = true;
      try {
        const n = await Account.signIn($("in-key").value);
        render(`Signed in. ${n ? `Brought in ${n} item${n === 1 ? "" : "s"} from your account.` : "Your account had nothing saved yet."}`);
      } catch (err) { render(`<span class="down">${esc(err.message)}</span>`); }
    };
  }
  window.addEventListener("synced", () => render());
  render();
})();
