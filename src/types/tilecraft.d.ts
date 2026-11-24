// @tilecraft is a Vite alias to the Tilecraft checkout (build/tilecraft-config.js, resolveTilecraft):
// its path differs per machine, so tsc cannot follow it. Its modules are untyped here.
declare module '@tilecraft/*';
