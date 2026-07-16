/** Remove the static HTML splash once the app is ready to paint. */
export function dismissSplash(): void {
  document.getElementById('splash')?.remove();
}
