import { useEffect, useRef } from 'react';

export interface EditorSubmissionAuthority {
  entityKey: string;
  session: number;
  generation: number;
  isSameSession: () => boolean;
  isCurrent: () => boolean;
}

/** Captures which editor session and draft generation a save actually submitted. */
export function useEditorAuthority(entityKey: string, draft: unknown): () => EditorSubmissionAuthority {
  const fingerprint = JSON.stringify(draft);
  const current = useRef({ entityKey, fingerprint, session: 1, generation: 0 });
  const mounted = useRef(false);

  if (current.current.entityKey !== entityKey) {
    current.current = { entityKey, fingerprint, session: current.current.session + 1, generation: 0 };
  } else if (current.current.fingerprint !== fingerprint) {
    current.current.fingerprint = fingerprint;
    current.current.generation += 1;
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  return () => {
    const { session, generation } = current.current;
    return {
      entityKey,
      session,
      generation,
      isSameSession: () => mounted.current && current.current.session === session,
      isCurrent: () => mounted.current
        && current.current.session === session
        && current.current.generation === generation,
    };
  };
}
