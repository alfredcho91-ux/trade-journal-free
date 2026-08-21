import { createContext, useContext, useMemo } from 'react';

export interface LocationState {
  pathname: string;
  search: string;
}

export interface NavigateOptions {
  replace?: boolean;
}

export interface RouterContextValue extends LocationState {
  navigate: (to: string, options?: NavigateOptions) => void;
  setSearchParams: (params: URLSearchParams, options?: NavigateOptions) => void;
}

export const RouterContext = createContext<RouterContextValue | null>(null);

function useRouterContext() {
  const context = useContext(RouterContext);
  if (!context) throw new Error('Router hooks must be used inside BrowserRouter');
  return context;
}

export function useLocation(): LocationState {
  const { pathname, search } = useRouterContext();
  return { pathname, search };
}

export function useNavigate() {
  return useRouterContext().navigate;
}

export function useSearchParams(): [
  URLSearchParams,
  (params: URLSearchParams, options?: NavigateOptions) => void,
] {
  const { search, setSearchParams } = useRouterContext();
  return [useMemo(() => new URLSearchParams(search), [search]), setSearchParams];
}
