/** The Documents home: the "Recent documents" label and its empty state (recents arrive with M-18), plus the interim "Sign in to GitHub" row that opens GitHubSignIn. */
import { githubSignInScreen } from './GitHubSignIn';
import { useNavigator } from '../shell/StackNavigator';

export function DocumentsHome() {
  const { push } = useNavigator();
  return (
    <>
      <button
        type="button"
        className="m-tap"
        style={{
          width: '100%',
          justifyContent: 'flex-start',
          borderBottom: '1px solid var(--border)',
          borderRadius: 0,
        }}
        onClick={() => push(githubSignInScreen)}
      >
        Sign in to GitHub
      </button>
      <div className="m-label">Recent documents</div>
      <div className="m-empty">
        <p>No recent documents.</p>
      </div>
    </>
  );
}
