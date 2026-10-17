// Only these locally authored messages may cross the plugin boundary.
// Transport and subprocess errors may contain tokens, argv or response bodies.
export class UsageError extends Error {}
