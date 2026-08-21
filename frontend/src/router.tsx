import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  RouterContext,
  type LocationState,
  type NavigateOptions,
  useNavigate,
} from './router-context';

function readLocation(): LocationState {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<LocationState>(readLocation);

  useEffect(() => {
    const handlePopState = () => setLocation(readLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const nextUrl = new URL(to, window.location.href);
    const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    if (options.replace) {
      window.history.replaceState(null, '', nextPath);
    } else {
      window.history.pushState(null, '', nextPath);
    }
    setLocation(readLocation());
  }, []);

  const setSearchParams = useCallback(
    (params: URLSearchParams, options: NavigateOptions = {}) => {
      const query = params.toString();
      navigate(`${location.pathname}${query ? `?${query}` : ''}`, options);
    },
    [location.pathname, navigate]
  );

  const value = useMemo(
    () => ({ ...location, navigate, setSearchParams }),
    [location, navigate, setSearchParams]
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();

  useEffect(() => {
    navigate(to, { replace });
  }, [navigate, replace, to]);

  return null;
}
