/**
 * Declares the source `.wasm` binary as a build dependency of the binding
 * generated from it.
 *
 * The bindings themselves are virtual modules whose content the plugin
 * refreshes on `watchRun`. Without this dependency rspack has no reason to
 * consider them outdated, so a rebuild would keep serving the previously
 * compiled binding and emit a stale binary.
 *
 * Kept as a standalone, dependency-free CommonJS file because rspack resolves
 * loaders by path and loads them outside the bundler's module graph.
 */
module.exports = function unwasmDependencyLoader(source) {
  const match = /^(.*\.wasm)(?:\.module)?\.unwasm\.mjs$/.exec(this.resourcePath);
  if (match) {
    this.addDependency(match[1]);
  }
  return source;
};
