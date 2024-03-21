import { OnboardingProvider } from '../hooks/use-onboarding';
import { SiteDetailsProvider } from '../hooks/use-site-details';
import App from './app';
import AuthProvider from './auth-provider';
import CrashTester from './crash-tester';
import ErrorBoundary from './error-boundary';

const Root = () => {
	return (
		<ErrorBoundary>
			<CrashTester />
			<AuthProvider>
				<SiteDetailsProvider>
					<OnboardingProvider>
						<App />
					</OnboardingProvider>
				</SiteDetailsProvider>
			</AuthProvider>
		</ErrorBoundary>
	);
};
export default Root;
