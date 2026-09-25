// Jest asset stub — image imports (e.g. Logo.tsx's logo-mark.png) resolve to this plain string
// under jest instead of the real binary file, since jest has no bundler transform for raw assets.
// .cjs (not .js) so it's unambiguously CommonJS regardless of this package's "type": "module".
module.exports = "test-file-stub";
