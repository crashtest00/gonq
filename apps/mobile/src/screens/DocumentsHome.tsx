/** The Documents home, empty for now: the "Recent documents" label and its empty state (recents and entry points arrive with M-18). */
export function DocumentsHome() {
  return (
    <>
      <div className="m-label">Recent documents</div>
      <div className="m-empty">
        <p>No recent documents.</p>
      </div>
    </>
  );
}
