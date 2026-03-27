#!/usr/bin/env node

// Keep the executable bit on a tracked wrapper because rebuilds of dist/index.js
// do not reliably preserve executable permissions for `npm link`.
import("../dist/index.js");
