(function () {
  'use strict';

  var U = window.SkyUI;
  var A = window.SkyApi;
  var LOCKED_ROLE = document.body.getAttribute('data-portal-role') || '';
  var state = {
    mode: 'login',
    role: 'owner',
    stalls: [],
    stallsLoaded: false,
    stallsError: null,
    selectedStallId: null,
    me: null,
    meta: null,
    resetContact: '',
    resetDemoCode: '',
    signup: null,
    resendTimer: null,
    availabilitySeq: 0
  };

  var ROLES = {
    owner: { label: 'Stall Owner', icon: 'store', blurb: 'Claim an open stall and run your shop.' },
    admin: { label: 'Administrator', icon: 'shield', blurb: 'Platform oversight, settings, and reports.' },
    operator: { label: 'Operator', icon: 'clipboard', blurb: 'Daily operations, stalls, and tickets.' }
  };
  if (!ROLES[LOCKED_ROLE]) LOCKED_ROLE = '';
  state.role = LOCKED_ROLE || 'owner';
  if (LOCKED_ROLE) document.body.classList.add('portal-' + LOCKED_ROLE);


  function makeCaptcha() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    state.captcha = code;
    return code;
  }
  function bindCaptcha() {
    var el = U.$('#captchaCode', card);
    if (el) el.textContent = state.captcha || makeCaptcha();
    var btn = U.$('#refreshCaptcha', card);
    if (btn) btn.addEventListener('click', function () {
      var code = makeCaptcha();
      var el2 = U.$('#captchaCode', card);
      if (el2) el2.textContent = code;
      var input = U.$('#regCaptcha', card) || U.$('#loginCaptcha', card);
      if (input) input.value = '';
    });
  }
  function checkCaptcha(form) {
    var input = form.elements.namedItem('captcha');
    if (!input) return true;
    if (String(input.value || '').trim().toUpperCase() !== String(state.captcha || '').toUpperCase()) {
      U.showFieldError(input, 'Captcha does not match. Try again.');
      makeCaptcha();
      var el = U.$('#captchaCode', card);
      if (el) el.textContent = state.captcha;
      input.value = '';
      return false;
    }
    return true;
  }

  var card = document.getElementById('authCard');
  var providerNote = document.getElementById('providerNote');

  function rolePicker() {
    if (LOCKED_ROLE) {
      var locked = ROLES[LOCKED_ROLE];
      return '<div class="portal-role-lock">'
        + '<span class="prl-ic">' + U.icon(locked.icon) + '</span>'
        + '<span class="prl-copy"><strong>' + U.esc(locked.label) + ' portal</strong><span>' + U.esc(locked.blurb) + '</span></span>'
        + '<a class="prl-link" href="/portal/">All portals</a></div>';
    }
    return '<div class="role-picker" role="group" aria-label="Choose your role">'
      + Object.keys(ROLES).map(function (key) {
        var role = ROLES[key];
        return '<button type="button" class="role-option ' + (state.role === key ? 'on' : '') + '" data-role="' + key + '" aria-pressed="' + (state.role === key ? 'true' : 'false') + '">'
          + '<span class="ro-ic">' + U.icon(role.icon) + '</span>'
          + '<span class="ro-name">' + U.esc(role.label) + '</span>'
          + '<span class="ro-sub">' + U.esc(role.blurb) + '</span></button>';
      }).join('') + '</div>'
      + '<p class="role-hint" id="roleHint">' + U.esc(state.mode === 'register'
        ? (state.role === 'owner' ? 'Owner accounts choose an available stall during registration.' : 'This account will be created with the ' + ROLES[state.role].label + ' role and opens that dashboard after registration.')
        : 'Your account’s assigned role decides which dashboard opens; the choice above sets the expected workspace.') + '</p>';
  }

  function authTabs() {
    return '<div class="auth-tabs" role="tablist" aria-label="Portal mode">'
      + '<button type="button" role="tab" aria-selected="' + (state.mode === 'login') + '" class="' + (state.mode === 'login' ? 'on' : '') + '" data-mode="login">Sign in</button>'
      + '<button type="button" role="tab" aria-selected="' + (state.mode === 'register') + '" class="' + (state.mode === 'register' ? 'on' : '') + '" data-mode="register">Create account</button>'
      + '</div>';
  }

  function authHead(title, text) {
    var eyebrow = LOCKED_ROLE ? 'SkyWorld Stall · ' + ROLES[LOCKED_ROLE].label + ' portal' : 'SkyWorld Stall portal';
    return '<div class="auth-head"><div class="eyebrow">' + U.esc(eyebrow) + '</div><h2>' + U.esc(title) + '</h2><p>' + U.esc(text) + '</p></div>';
  }

  function renderAuth() {
    U.clearFieldErrors(card);
    if (state.mode === 'verify' && state.signup) renderVerify();
    else if (state.mode === 'register') renderRegister();
    else if (state.mode === 'forgot') renderForgot();
    else renderLogin();
    U.initPasswords(card);
  }

  function bindRoleButtons(onChange) {
    U.$$('[data-role]', card).forEach(function (button) {
      button.addEventListener('click', function () {
        state.role = button.dataset.role;
        U.$$('[data-role]', card).forEach(function (other) {
          var on = other === button;
          other.classList.toggle('on', on);
          other.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        var isOwner = state.role === 'owner';
        var hint = U.$('#roleHint', card);
        if (hint) {
          hint.textContent = state.mode === 'login'
            ? ROLES[state.role].label + ' workspace selected. Your account’s real role decides where you land.'
            : isOwner
              ? 'Owner accounts choose an available stall during registration.'
              : 'This account will be created with the ' + ROLES[state.role].label + ' role and opens that dashboard after registration.';
        }
        var title = U.$('[data-role-title]', card);
        if (title) title.textContent = isOwner ? 'Sign in to your stall' : 'Sign in to the ' + ROLES[state.role].label + ' desk';
        var sub = U.$('[data-role-sub]', card);
        if (sub) sub.textContent = ROLES[state.role].blurb;
        var callToAction = U.$('[data-role-cta]', card);
        if (callToAction) callToAction.textContent = state.mode === 'register' ? 'Create ' + ROLES[state.role].label.toLowerCase() + ' account' : 'Sign in';
        if (state.mode === 'register' && isOwner && !state.stallsLoaded && !state.stallsError) {
          loadStalls().then(function () { if (state.mode === 'register') renderRegister(); });
        }
        if (state.mode === 'register') {
          var stallArea = U.$('#stallArea', card);
          if (stallArea) stallArea.hidden = !isOwner;
          if (!isOwner) state.selectedStallId = null;
          var confirmText = U.$('#confirmText', card);
          if (confirmText) {
            confirmText.textContent = isOwner
              ? 'I confirm these details are correct and understand that a claimed stall cannot be assigned to another owner.'
              : 'I confirm these account details are correct and understand the permissions of the ' + ROLES[state.role].label + ' role.';
          }
          var registerBtn = U.$('#registerBtn', card);
          if (registerBtn) registerBtn.textContent = 'Create ' + ROLES[state.role].label.toLowerCase() + ' account';
        }
        if (onChange) onChange();
      });
    });
  }

  function bindTabs() {
    U.$$('[data-mode]', card).forEach(function (button) {
      button.addEventListener('click', function () {
        state.mode = button.dataset.mode;
        renderAuth();
        if (state.mode === 'register' && state.role === 'owner' && !state.stallsLoaded && !state.stallsError) {
          loadStalls().then(function () { if (state.mode === 'register') renderRegister(); });
        }
      });
    });
  }

  /* ---------- sign in ---------- */
  function loginCopy() {
    if (LOCKED_ROLE === 'admin') return ['Welcome back, administrator', 'Sign in to platform oversight, stall governance, settings, and reports. The server checks the administrator role on every request.'];
    if (LOCKED_ROLE === 'operator') return ['Welcome back, operator', 'Sign in to daily stall operations, monitoring, tickets, and visits. Platform settings stay outside this portal.'];
    if (LOCKED_ROLE === 'owner') return ['Sign in to your stall', 'Manage your inventory, products, orders, reviews, and reports. The server only exposes the stall linked to your account.'];
    return ['Welcome back', 'Sign in once to reach your storefront dashboard, stall workspace, admin desk, or operator floor.'];
  }

  function registerCopy() {
    if (LOCKED_ROLE === 'admin') return ['Create an administrator account', 'This portal registers the Administrator role. Platform accounts are kept separate from stall ownership.'];
    if (LOCKED_ROLE === 'operator') return ['Create an operator account', 'This portal registers the Operator role for daily stall operations. Platform settings are not granted to operators.'];
    if (LOCKED_ROLE === 'owner') return ['Create your stall owner account', 'Choose one of the ten stalls during registration. The link to your stall is stored once and cannot be claimed twice.'];
    return ['Create your account', 'One shared registration for stall owners and platform staff. Your role is verified by the server.'];
  }

  function renderLogin() {
    var copy = loginCopy();
    card.innerHTML = authHead(copy[0], copy[1])
      + authTabs()
      + rolePicker()
      + '<form class="auth-form" id="loginForm" novalidate>'
      + '<div class="field"><label for="loginId">Email or mobile number</label>'
      + '<input id="loginId" name="identifier" type="text" autocomplete="username" placeholder="you@example.com or 0917 123 4567" required autofocus>'
      + '<div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="loginPassword">Password</label>'
      + '<div class="pw-wrap"><input id="loginPassword" name="password" type="password" autocomplete="current-password" placeholder="Your password" required>'
      + '<button type="button" class="pw-eye" aria-label="Show password" title="Show password" aria-pressed="false">' + U.icon('eye') + '</button></div>'
      + '<div class="err-text" data-field-error></div></div>'
      + '<div class="form-between"><button type="button" class="btn link" id="forgotLink">Forgot password?</button></div>'
      + '<div class="field captcha-field"><label for="loginCaptcha">Captcha</label>'
      + '<div class="captcha-display"><span class="captcha-code" id="captchaCode" aria-hidden="true"></span>'
      + '<button type="button" class="btn ghost sm" id="refreshCaptcha" title="Refresh captcha">' + U.icon('refresh') + '</button></div>'
      + '<input id="loginCaptcha" name="captcha" type="text" autocomplete="off" placeholder="Enter the code shown" required maxlength="8">'
      + '<div class="err-text" data-field-error></div></div>'
      + '<button class="btn lg block" type="submit" id="loginBtn">Sign in</button>'
      + '</form>'
      + '<div class="auth-alt">New to SkyWorld? <button type="button" id="toRegister">Create an account</button></div>';
    bindTabs(); bindRoleButtons(); bindCaptcha();
    U.$('#forgotLink', card).addEventListener('click', function () { state.mode = 'forgot'; state.resetContact = ''; state.resetDemoCode = ''; renderAuth(); });
    U.$('#toRegister', card).addEventListener('click', function () {
      state.mode = 'register';
      renderAuth();
      if (state.role === 'owner' && !state.stallsLoaded) loadStalls().then(function () { if (state.mode === 'register') renderRegister(); });
    });
    var form = U.$('#loginForm', card);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      U.clearFieldErrors(form); U.clearFormError(form);
      if (!checkCaptcha(form)) return;
      var button = U.$('#loginBtn', card);
      U.setBusy(button, true, 'Signing in…');
      try {
        var result = await A.login({
          identifier: form.identifier.value.trim(),
          password: form.password.value
        });
        state.me = { user: result.user, home: result.home };
        var actualRole = result.user.role;
        var mismatch = actualRole !== state.role;
        var message = 'Signed in as ' + U.titleCase(actualRole) + '. Opening your dashboard.';
        if (mismatch) {
          message = LOCKED_ROLE
            ? 'Signed in as ' + U.titleCase(actualRole) + '. This portal is reserved for ' + ROLES[LOCKED_ROLE].label + ' accounts, so the ' + U.titleCase(actualRole) + ' dashboard will open instead.'
            : 'Signed in as ' + U.titleCase(actualRole) + '. Opening the ' + U.titleCase(actualRole) + ' dashboard.';
        }
        renderRedirect(result, message);
      } catch (error) {
        U.applyApiError(form, error);
        U.setBusy(button, false);
      }
    });
  }

  /* ---------- register ---------- */
  function stallPickerHTML() {
    if (!state.stallsLoaded && !state.stallsError) {
      return '<div class="stall-loading"><span class="spinner"></span>Loading stalls…</div>';
    }
    if (state.stallsError) {
      return '<div class="notice er">' + U.esc(state.stallsError) + '</div><button type="button" class="btn ghost sm mt-2" id="retryStalls">' + U.icon('refresh') + 'Try again</button>';
    }
    var available = state.stalls.filter(function (stall) { return stall.occupancy === 'available'; }).length;
    return '<div class="stall-section-head"><h3>Choose stall number</h3><span>' + available + ' of ' + state.stalls.length + ' available</span></div>'
      + '<div class="stall-picker stall-picker-numbers" role="group" aria-label="Available stalls">'
      + state.stalls.map(function (stall) {
        var free = stall.occupancy === 'available';
        var selected = state.selectedStallId === stall.id;
        return '<button type="button" class="stall-option stall-num ' + (selected ? 'on' : '') + '" data-stall="' + stall.id + '"'
          + (free ? '' : ' disabled') + ' aria-pressed="' + selected + '" title="' + (free ? 'Stall ' + stall.id : 'Already owned') + '">'
          + '<span class="so-num">' + stall.id + '</span>'
          + (free ? '' : '<span class="so-state">Taken</span>')
          + '</button>';
      }).join('') + '</div>'
      + '<div class="stall-selected-note ' + (state.selectedStallId ? 'show' : '') + '" id="stallSelectedNote">'
      + (state.selectedStallId ? 'Stall ' + state.selectedStallId + ' will be linked to your account.' : '') + '</div>';
  }

  function bindStallPicker() {
    U.$$('[data-stall]', card).forEach(function (button) {
      button.addEventListener('click', function () {
        state.selectedStallId = Number(button.dataset.stall);
        U.$$('[data-stall]', card).forEach(function (other) {
          other.classList.toggle('on', other === button);
          other.setAttribute('aria-pressed', other === button ? 'true' : 'false');
        });
        var note = U.$('#stallSelectedNote', card);
        var stall = state.stalls.find(function (entry) { return entry.id === state.selectedStallId; });
        if (note && stall) {
          note.textContent = 'Stall ' + stall.id + ' will be linked to your account.';
          note.classList.add('show');
        }
      });
    });
    var retry = U.$('#retryStalls', card);
    if (retry) retry.addEventListener('click', function () { state.stallsError = null; state.stallsLoaded = false; loadStalls().then(renderRegister); });
  }

  function renderRegister() {
    var isOwner = state.role === 'owner';
    var copy = registerCopy();
    var note = isOwner
      ? 'Demo catalogues already exist for every stall as sample data. After you register, the stall is linked to your account and you go straight to the owner dashboard. Platform admins are notified so they can review the account.'
      : LOCKED_ROLE
        ? 'This installation accepts ' + ROLES[LOCKED_ROLE].label.toLowerCase() + ' self-registration. Your account is created immediately and you open the dashboard right away. Platform admins are notified so they can review whether to keep the account.'
        : 'Staff self-registration creates the account immediately and opens that dashboard. Register only if you are authorised. Platform admins are notified so they can review whether to keep the account.';
    card.innerHTML = authHead(copy[0], copy[1])
      + authTabs()
      + rolePicker()
      + '<form class="auth-form" id="registerForm" novalidate>'
      + '<div class="form-grid">'
      + '<div class="field span-2"><label for="regName">Full name</label><input id="regName" name="name" type="text" autocomplete="name" placeholder="Maria Santos" required><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="regEmail">Email address</label><input id="regEmail" name="email" type="email" autocomplete="email" placeholder="you@example.com" required><div class="avail-line" id="emailAvail"></div><div class="err-text" data-field-error></div></div>'
      + '<div class="field"><label for="regPhone">Mobile number</label><input id="regPhone" name="phone" type="tel" autocomplete="tel" placeholder="0917 123 4567" required><div class="avail-line" id="phoneAvail"></div><div class="err-text" data-field-error></div></div>'
      + U.passwordFieldHTML({ id: 'regPassword', name: 'password', label: 'Password', autocomplete: 'new-password', required: true, span: true })
      + U.passwordFieldHTML({ id: 'regConfirm', name: 'confirmPassword', label: 'Confirm password', autocomplete: 'new-password', required: true, span: true, meter: false })
     
      + '<div class="field span-2 captcha-field"><label for="regCaptcha">Captcha</label>'
      + '<div class="captcha-display"><span class="captcha-code" id="captchaCode" aria-hidden="true"></span>'
      + '<button type="button" class="btn ghost sm" id="refreshCaptcha" title="Refresh captcha">' + U.icon('refresh') + '</button></div>'
      + '<input id="regCaptcha" name="captcha" type="text" autocomplete="off" placeholder="Enter the code shown" required maxlength="8">'
      + '<div class="err-text" data-field-error></div></div>'
      + '</div>'
      + '<div id="stallArea" ' + (isOwner ? '' : 'hidden') + '>'
      + '<div class="stall-section">' + stallPickerHTML() + '</div>'
      + '<div class="err-text" id="stallError"></div></div>'
      + '<label class="checkline"><input type="checkbox" name="confirmDetails" required><span id="confirmText">' + (isOwner
        ? 'I confirm these details are correct and understand that a claimed stall cannot be assigned to another owner.'
        : 'I confirm these account details are correct and understand the permissions of the ' + ROLES[state.role].label + ' role.') + '</span></label>'
      + '<button class="btn lg block" type="submit" id="registerBtn">Create ' + (isOwner ? 'owner' : ROLES[state.role].label.toLowerCase()) + ' account</button>'
      + '</form>'
      + '<div class="auth-alt">Already registered? <button type="button" id="toLogin">Sign in</button></div>'
      + '<div class="portal-note">' + U.icon('info') + '<span>' + U.esc(note) + '</span></div>';
    bindTabs(); bindRoleButtons(); bindStallPicker(); bindCaptcha();
    U.initPasswords(card);
    U.$('#toLogin', card).addEventListener('click', function () { state.mode = 'login'; renderAuth(); });

    var form = U.$('#registerForm', card);
    bindAvailability(form);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      U.clearFieldErrors(form); U.clearFormError(form);
      var stallError = U.$('#stallError', card);
      if (stallError) stallError.textContent = '';
      var name = form.elements.namedItem('name').value.trim();
      var email = form.elements.namedItem('email').value.trim();
      var phone = form.elements.namedItem('phone').value.trim();
      var password = form.elements.namedItem('password').value;
      var confirm = form.elements.namedItem('confirmPassword').value;
      var evaluation = U.passwordEvaluation(password);
      if (name.length < 2) return U.showFieldError(form.elements.namedItem('name'), 'Enter your full name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return U.showFieldError(form.elements.namedItem('email'), 'Enter a valid email address.');
      if (phone.replace(/\D/g, '').length < 10) return U.showFieldError(form.elements.namedItem('phone'), 'Enter a valid Philippine mobile number, such as 0917 123 4567.');
      if (!evaluation.ok) return U.showFieldError(form.elements.namedItem('password'), 'Use 8–20 characters with letters, numbers or symbols, and at least three character types.');
      if (password !== confirm) return U.showFieldError(form.elements.namedItem('confirmPassword'), 'The password confirmation does not match.');
      if (!checkCaptcha(form)) return;
      if (state.role === 'owner' && !state.selectedStallId) {
        if (stallError) stallError.textContent = 'Choose an available stall before creating your owner account.';
        var stallArea = U.$('#stallArea', card);
        if (stallArea) stallArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!form.elements.namedItem('confirmDetails').checked) {
        U.formError(form, 'Tick the confirmation box before continuing.');
        return;
      }
      var stall = state.stalls.find(function (entry) { return entry.id === state.selectedStallId; });
      var confirmed = await U.confirmDialog({
        title: state.role === 'owner' ? 'Claim this stall?' : 'Create this staff account?',
        message: state.role === 'owner'
          ? 'Please confirm the account and stall. Your owner account will be created immediately and you will open the owner dashboard.'
          : 'Please confirm the new staff account. It will be created immediately and you will open that dashboard. Platform admins will be notified so they can review whether to keep it.',
        detail: '<div class="stack small">'
          + '<div><span class="muted">Name:</span> <strong>' + U.esc(name) + '</strong></div>'
          + '<div><span class="muted">Role:</span> <strong>' + U.esc(ROLES[state.role].label) + '</strong></div>'
          + '<div><span class="muted">Email:</span> <strong>' + U.esc(email) + '</strong></div>'
          + (state.role === 'owner' && stall ? '<div><span class="muted">Stall:</span> <strong>' + U.esc(stall.name) + '</strong> (' + U.esc(stall.category) + ')</div>' : '')
          + '</div>',
        confirmLabel: 'Create account',
        cancelLabel: 'Go back'
      });
      if (!confirmed) return;
      var button = U.$('#registerBtn', card);
      U.setBusy(button, true, 'Creating account…');
      try {
        var payload = {
          role: state.role,
          name: name,
          email: email,
          phone: phone,
          password: password,
          confirmPassword: confirm
        };
        if (state.role === 'owner') {
          payload.stallId = state.selectedStallId;
        }
        var result = await A.registerStart(payload);
        U.toast(result.message || 'Account created.', 'ok');
        window.location.href = result.home || (state.role === 'admin' ? '/admin/' : state.role === 'operator' ? '/operator/' : '/owner/');
      } catch (error) {
        U.applyApiError(form, error);
        if (error.field === 'stallId') {
          if (stallError) stallError.textContent = error.message;
          state.selectedStallId = null;
          state.stallsLoaded = false;
          loadStalls().then(function () {
            var area = U.$('#stallArea', card);
            if (area) {
              var section = U.$('.stall-section', area);
              if (section) section.innerHTML = stallPickerHTML();
              bindStallPicker();
            }
          });
        }
        U.setBusy(button, false);
      }
    });
  }

  function stopResendTimer() {
    if (state.resendTimer) {
      clearInterval(state.resendTimer);
      state.resendTimer = null;
    }
  }

  function refreshResendButton() {
    var button = U.$('#resendCode', card);
    if (!button || !state.signup) return;
    var remaining = Math.ceil((state.signup.resendAt - Date.now()) / 1000);
    if (remaining > 0) {
      button.disabled = true;
      button.textContent = 'Resend code in ' + remaining + 's';
    } else {
      button.disabled = false;
      button.textContent = 'Resend code';
    }
  }

  function renderVerify() {
    stopResendTimer();
    var signup = state.signup;
    var label = signup.channel === 'email' ? 'email' : 'SMS';
    var demoNotice = signup.sent
      ? '<div class="notice info">' + U.icon(signup.channel === 'email' ? 'mail' : 'phone') + '<span>We sent a six-digit code to <strong>' + U.esc(signup.contact) + '</strong> by ' + label + '. It expires in 10 minutes.</span></div>'
      : '<div class="notice info">' + U.icon('info') + '<span>Enter the six-digit verification code for <strong>' + U.esc(signup.contact) + '</strong>. If you did not receive it, use Resend code below.</span></div>';
    card.innerHTML = authHead('Enter your verification code',
      'Confirm ' + signup.contact + ' before we create the ' + ROLES[signup.role].label.toLowerCase() + ' account' + (signup.stallName ? ' for ' + signup.stallName : '') + '.')
      + '<div class="reset-steps"><span class="reset-step done"><span class="n">' + U.icon('check') + '</span>Details</span><span class="reset-line"></span><span class="reset-step on"><span class="n">2</span>Verify</span></div>'
      + demoNotice
      + '<form class="auth-form" id="verifyForm" novalidate>'
      + '<div class="field"><label for="signupCode">Six-digit code</label>'
      + '<input id="signupCode" name="code" class="code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000" required autofocus>'
      + '<div class="hint">Sent via ' + label + ' to ' + U.esc(signup.contact) + '. Check your spam or junk folder if it has not arrived.</div>'
      + '<div class="err-text" data-field-error></div></div>'
      + '<button class="btn lg block" type="submit" id="verifyBtn">Verify and create account</button>'
      + '</form>'
      + '<div class="auth-alt"><button type="button" id="resendCode">Resend code</button> · <button type="button" id="editDetails">Use different details</button></div>'
      + '<div class="portal-note">' + U.icon('lock') + '<span>The account is not created until the code is verified. Codes are single-use and expire after 10 minutes.</span></div>';
    refreshResendButton();
    state.resendTimer = setInterval(function () {
      if (state.mode !== 'verify' || !U.$('#resendCode', card)) { stopResendTimer(); return; }
      refreshResendButton();
    }, 1000);

    U.$('#editDetails', card).addEventListener('click', function () {
      stopResendTimer();
      state.signup = null;
      state.mode = 'register';
      renderAuth();
    });
    U.$('#resendCode', card).addEventListener('click', async function () {
      var button = U.$('#resendCode', card);
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = 'Sending…';
      try {
        var result = await A.registerResend(signup.token);
        state.signup = Object.assign({}, signup, {
          channel: result.channel,
          contact: result.contact,
          demoCode: '',
          sent: result.sent,
          message: result.message,
          resendAt: Date.now() + 30000
        });
        U.toast(result.message, result.sent ? 'ok' : 'wa');
        renderVerify();
      } catch (error) {
        var wait = error.details && Number(error.details.retryAfter);
        if (wait > 0) state.signup.resendAt = Date.now() + wait * 1000;
        if (error.code === 'signup_expired') {
          stopResendTimer();
          state.signup = null;
          state.mode = 'register';
          renderAuth();
        } else {
          refreshResendButton();
        }
        U.toast(error.message, 'er');
      }
    });

    var form = U.$('#verifyForm', card);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      U.clearFieldErrors(form); U.clearFormError(form);
      var code = form.elements.namedItem('code').value.trim();
      if (!/^\d{6}$/.test(code)) return U.showFieldError(form.elements.namedItem('code'), 'Enter the six-digit code.');
      var button = U.$('#verifyBtn', card);
      U.setBusy(button, true, 'Verifying…');
      try {
        var result = await A.registerVerify(state.signup.token, code);
        stopResendTimer();
        state.signup = null;
        state.me = { user: result.user, home: result.home };
        renderRedirect(result, result.message || 'Your account is verified.');
      } catch (error) {
        U.applyApiError(form, error);
        if (error.code === 'code_expired' || error.code === 'code_locked') {
          state.signup.resendAt = Date.now();
          refreshResendButton();
          U.toast(error.message, 'wa');
        }
        if (error.code === 'signup_expired') {
          stopResendTimer();
          state.signup = null;
          state.mode = 'register';
          U.toast(error.message, 'wa');
          renderAuth();
          return;
        }
        U.setBusy(button, false);
      }
    });
  }

  function bindAvailability(form) {
    var email = form.elements.namedItem('email');
    var phone = form.elements.namedItem('phone');
    var check = U.debounce(async function () {
      var emailValue = email.value.trim();
      var phoneValue = phone.value.trim();
      var seq = ++state.availabilitySeq;
      if (!emailValue && !phoneValue) { U.$('#emailAvail', card).textContent = ''; U.$('#phoneAvail', card).textContent = ''; return; }
      try {
        var data = await A.get('/api/auth/availability?email=' + encodeURIComponent(emailValue) + '&phone=' + encodeURIComponent(phoneValue));
        if (seq !== state.availabilitySeq) return;
        var emailLine = U.$('#emailAvail', card);
        var phoneLine = U.$('#phoneAvail', card);
        if (emailLine) {
          if (data.emailAvailable === false) { emailLine.textContent = 'This email is already registered.'; emailLine.className = 'avail-line bad'; }
          else if (data.emailAvailable === true) { emailLine.textContent = 'Email is available.'; emailLine.className = 'avail-line ok'; }
          else { emailLine.textContent = ''; emailLine.className = 'avail-line'; }
        }
        if (phoneLine) {
          if (data.phoneAvailable === false) { phoneLine.textContent = 'This mobile number is already registered.'; phoneLine.className = 'avail-line bad'; }
          else if (data.phoneAvailable === true) { phoneLine.textContent = 'Mobile number is available.'; phoneLine.className = 'avail-line ok'; }
          else { phoneLine.textContent = ''; phoneLine.className = 'avail-line'; }
        }
      } catch (_) {}
    }, 420);
    email.addEventListener('input', check);
    phone.addEventListener('input', check);
  }

  /* ---------- password recovery ---------- */
  function renderForgot(step) {
    var notice = '<div class="notice info" style="margin-bottom:14px">' + U.icon('info') + ' If the details match an active account, a one-time code is sent to your email or mobile number.</div>';
    if (step === 'reset') {
      var contact = state.resetContact;
      card.innerHTML = authHead('Enter your reset code', 'If ' + contact + ' belongs to an active account, enter the code that was sent. It expires in 15 minutes.')
        + '<div class="reset-steps"><span class="reset-step done"><span class="n">' + U.icon('check') + '</span>Request</span><span class="reset-line"></span><span class="reset-step on"><span class="n">2</span>Reset password</span></div>'
        + notice
        + '<form class="auth-form" id="resetForm" novalidate>'
        + '<div class="field"><label for="resetCode">Six-digit code</label><input id="resetCode" name="code" class="code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000" required><div class="err-text" data-field-error></div></div>'
        + U.passwordFieldHTML({ id: 'resetPassword', name: 'password', label: 'New password', autocomplete: 'new-password', required: true })
        + U.passwordFieldHTML({ id: 'resetConfirm', name: 'confirmPassword', label: 'Confirm new password', autocomplete: 'new-password', required: true, meter: false })
        + '<button class="btn lg block" type="submit" id="resetBtn">Change password</button>'
        + '</form>'
        + '<div class="auth-alt"><button type="button" id="backRequest">Request a new code</button> · <button type="button" id="backSignIn">Back to sign in</button></div>';
      U.initPasswords(card);
      U.$('#backRequest', card).addEventListener('click', function () { state.resetDemoCode = ''; renderForgot('request'); });
      U.$('#backSignIn', card).addEventListener('click', function () { state.mode = 'login'; renderAuth(); });
      var form = U.$('#resetForm', card);
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        U.clearFieldErrors(form); U.clearFormError(form);
        if (!/^\d{6}$/.test(form.elements.namedItem('code').value.trim())) return U.showFieldError(form.elements.namedItem('code'), 'Enter the six-digit code.');
        var evaluation = U.passwordEvaluation(form.elements.namedItem('password').value);
        if (!evaluation.ok) return U.showFieldError(form.elements.namedItem('password'), 'Use 8–20 characters with letters, numbers or symbols, and at least three character types.');
        if (form.elements.namedItem('password').value !== form.elements.namedItem('confirmPassword').value) {
          return U.showFieldError(form.elements.namedItem('confirmPassword'), 'The password confirmation does not match.');
        }
        var button = U.$('#resetBtn', card);
        U.setBusy(button, true, 'Changing…');
        try {
          var result = await A.post('/api/auth/reset-password', {
            contact: state.resetContact,
            code: form.elements.namedItem('code').value.trim(),
            password: form.elements.namedItem('password').value,
            confirmPassword: form.elements.namedItem('confirmPassword').value
          });
          card.innerHTML = '<div class="success-view"><div class="success-ic">' + U.icon('check') + '</div>'
            + '<h2>Password changed</h2><p>' + U.esc(result.message) + ' This reset code can no longer be used.</p>'
            + '<button type="button" class="btn lg block" id="doneSignIn">Back to sign in</button></div>';
          U.$('#doneSignIn', card).addEventListener('click', function () { state.mode = 'login'; renderAuth(); });
        } catch (error) {
          U.applyApiError(form, error);
          U.setBusy(button, false);
        }
      });
      return;
    }
    card.innerHTML = authHead('Reset your password', 'Use the email address or mobile number registered to your account.')
      + '<div class="reset-steps"><span class="reset-step on"><span class="n">1</span>Request a code</span><span class="reset-line"></span><span class="reset-step"><span class="n">2</span>Reset password</span></div>'
      + notice
      + '<form class="auth-form" id="forgotForm" novalidate>'
      + '<div class="field"><label for="forgotContact">Email or mobile number</label><input id="forgotContact" name="contact" type="text" autocomplete="username" placeholder="you@example.com or 0917 123 4567" required autofocus><div class="err-text" data-field-error></div></div>'
      + '<button class="btn lg block" type="submit" id="forgotBtn">Send reset code</button>'
      + '</form>'
      + '<div class="auth-alt"><button type="button" id="backSignIn2">Back to sign in</button></div>';
    U.$('#backSignIn2', card).addEventListener('click', function () { state.mode = 'login'; renderAuth(); });
    var form = U.$('#forgotForm', card);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      U.clearFieldErrors(form); U.clearFormError(form);
      var contact = form.elements.namedItem('contact').value.trim();
      if (contact.length < 5) return U.showFieldError(form.elements.namedItem('contact'), 'Enter the email address or mobile number on your account.');
      var button = U.$('#forgotBtn', card);
      U.setBusy(button, true, 'Sending…');
      try {
        var result = await A.post('/api/auth/forgot-password', { contact: contact });
        state.resetContact = contact;
        state.resetDemoCode = '';
        if (result.delivered === false && !state.resetDemoCode) {
          U.formError(form, result.message);
          U.setBusy(button, false);
          return;
        }
        U.toast(result.message, result.delivered === false ? 'wa' : 'ok');
        renderForgot('reset');
      } catch (error) {
        U.applyApiError(form, error);
        U.setBusy(button, false);
      }
    });
  }

  /* ---------- success / signed in ---------- */
  function renderRedirect(result, message) {
    var home = result.home || (result.user ? (result.user.role === 'admin' ? '/admin/' : result.user.role === 'operator' ? '/operator/' : '/owner/') : '/portal/');
    card.innerHTML = '<div class="success-view"><div class="success-ic">' + U.icon('check') + '</div>'
      + '<h2>You’re in</h2><p>' + U.esc(message) + '</p>'
      + '<div class="loading-block" style="padding:8px 0 16px"><span class="spinner"></span>Taking you to your dashboard…</div>'
      + '<a class="btn lg block" href="' + U.attr(home) + '">Open dashboard now</a></div>';
    setTimeout(function () { window.location.replace(home); }, 1200);
  }

  function renderSignedIn() {
    var me = state.me;
    var user = me.user;
    var stall = me.stall;
    card.innerHTML = '<div class="signed-in">'
      + U.avatar(user.name, 'lg si-avatar')
      + '<div class="role-chip">' + U.icon(user.role === 'owner' ? 'store' : user.role === 'admin' ? 'shield' : 'clipboard') + U.titleCase(user.role) + '</div>'
      + '<h2>Welcome back, ' + U.esc(user.name.split(' ')[0]) + '</h2>'
      + '<p>' + U.esc(user.email) + (stall ? ' · ' + U.esc(stall.name) : '') + '</p>'
      + '<a class="btn lg block" href="' + U.attr(me.home || '/portal/') + '">Continue to my dashboard</a>'
      + '<div class="btn-row mt-2" style="justify-content:center"><a class="btn ghost" href="/store/">Browse the store</a><button class="btn ghost" type="button" id="portalSignOut">Sign out</button></div>'
      + '<div class="portal-note" style="text-align:left">' + U.icon('info') + '<span>'
      + (LOCKED_ROLE && user.role !== LOCKED_ROLE
        ? 'You are signed in as ' + U.titleCase(user.role) + ', but this portal is reserved for ' + ROLES[LOCKED_ROLE].label + ' accounts. Sign out to use a different account.'
        : 'You are already signed in. Sign out first if you need to use a different account. Administrative accounts never need to share owner credentials.')
      + '</span></div>'
      + '</div>';
    U.$('#portalSignOut', card).addEventListener('click', async function () {
      await A.logout();
      state.me = null;
      state.mode = 'login';
      renderAuth();
      U.toast('You have signed out.', 'ok');
    });
  }

  /* ---------- data ---------- */
  async function loadStalls() {
    state.stallsError = null;
    try {
      var data = await A.get('/api/store/stalls');
      state.stalls = data.stalls || [];
      state.stallsLoaded = true;
    } catch (error) {
      state.stallsError = error.message || 'The stall list could not be loaded.';
      state.stallsLoaded = false;
    }
  }

  function setProviderNote() {
    if (!providerNote) return;
    providerNote.textContent = 'New accounts are created immediately. Platform admins receive a dashboard notification so they can review whether to keep each registration.';
  }

  async function init() {
    var params = new URLSearchParams(window.location.search);
    if (!LOCKED_ROLE) {
      state.role = 'owner';
      if (params.get('role') && ROLES[params.get('role')]) state.role = params.get('role');
    }
    if (params.get('mode') === 'register') state.mode = 'register';
    if (params.get('mode') === 'login') state.mode = 'login';
    try {
      var results = await Promise.all([
        A.boot(),
        A.get('/api/meta').catch(function () { return null; })
      ]);
      state.me = results[0];
      state.meta = results[1];
    } catch (_) {
      state.me = { user: null };
    }
    setProviderNote();
    if (state.me && state.me.user) {
      renderSignedIn();
      return;
    }
    if (state.mode === 'register' && state.role === 'owner') {
      card.innerHTML = '<div class="loading-block"><span class="spinner"></span>Preparing registration…</div>';
      await loadStalls();
    }
    renderAuth();
    if (!state.stallsLoaded && !state.stallsError) {
      loadStalls().then(function () {
        if (state.mode === 'register' && state.role === 'owner') renderRegister();
      });
    }
  }

  init();
})();
