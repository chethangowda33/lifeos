// Test IDs for the auth feature (login, register, password reset, logout).
// Add new keys here as you wire up additional auth UI; see ./index.js for
// the recipe to add a new feature file.
//
// Directive:
//   - Keys are camelCase, values are kebab-case shaped as `<feature>-<element>`
//     (or `<feature>-<element>-<qualifier>` when an element repeats). Examples:
//     'login-submit-button', 'cart-quantity-input', 'product-card-image'.
//   - Reference them in JSX as `data-testid={LOGIN.submitButton}`.
//
// Why kebab-case values: keeps them usable as stable CSS-attribute selectors
// in end-to-end tests.

export const LOGIN = {
	emailInput: 'login-email-input',
	passwordInput: 'login-password-input',
	submitButton: 'login-submit-button',
	forgotPasswordLink: 'login-forgot-password-link',
	registerLink: 'login-register-link',
};

export const REGISTER = {
	nameInput: 'register-name-input',
	emailInput: 'register-email-input',
	passwordInput: 'register-password-input',
	passwordConfirmInput: 'register-password-confirm-input',
	submitButton: 'register-submit-button',
	loginLink: 'register-login-link',
};

export const FORGOT_PASSWORD = {
	emailInput: 'forgot-password-email-input',
	submitButton: 'forgot-password-submit-button',
	loginLink: 'forgot-password-login-link',
};

export const RESET_PASSWORD = {
	passwordInput: 'reset-password-password-input',
	passwordConfirmInput: 'reset-password-confirm-input',
	submitButton: 'reset-password-submit-button',
	loginLink: 'reset-password-login-link',
};

export const LOGOUT = {
	button: 'logout-button',
};
