import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  configureExchangeCredentials,
  deleteExchangeCredentials,
  getExchangeStatuses,
} from '../../api/client';
import type { ExchangeId } from '../../types';
import { exchangeQueryKeys } from './exchangeQueryKeys';

type CredentialValues = {
  api_key: string;
  secret_key: string;
  passphrase?: string;
};

export function useExchangeConnection({
  selectedExchange,
  isKo,
  onMessage,
  onConnectionChanged,
}: {
  selectedExchange: ExchangeId;
  isKo: boolean;
  onMessage: (message: string) => void;
  onConnectionChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const statusesQuery = useQuery({
    queryKey: exchangeQueryKeys.statuses,
    queryFn: getExchangeStatuses,
    staleTime: 60_000,
  });
  const selectedStatus = statusesQuery.data?.find((item) => item.id === selectedExchange);

  const connectMutation = useMutation({
    mutationFn: configureExchangeCredentials,
    onSuccess: async (_statuses, variables) => {
      await queryClient.invalidateQueries({ queryKey: exchangeQueryKeys.statuses });
      const name = statusesQuery.data?.find((item) => item.id === variables.exchange)?.name || 'Exchange';
      onMessage(isKo
        ? `${name === 'Exchange' ? '거래소' : name} 읽기 전용 연결을 확인하고 보호 저장소에 저장했습니다.`
        : `${name} read-only connection verified and saved in protected storage.`);
      onConnectionChanged();
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: deleteExchangeCredentials,
    onSuccess: async (result) => {
      queryClient.setQueryData(exchangeQueryKeys.statuses, result.exchanges);
      await queryClient.invalidateQueries({ queryKey: exchangeQueryKeys.statuses });
      onMessage(result.environment_override
        ? (isKo ? '저장된 연결은 삭제했지만 배포 환경 Secret이 남아 있어 연결 상태가 유지됩니다.' : 'Saved credentials were removed, but the deployment secret still keeps this exchange connected.')
        : (isKo ? '거래소 API 연결과 저장된 인증 정보를 삭제했습니다.' : 'Exchange connection and stored credentials were removed.'));
      onConnectionChanged();
    },
  });

  return {
    exchangeStatuses: statusesQuery.data,
    selectedExchangeStatus: selectedStatus,
    connect: (values: CredentialValues) => connectMutation.mutate({ exchange: selectedExchange, ...values }),
    disconnect: () => disconnectMutation.mutate(selectedExchange),
    connectionError: connectMutation.error || disconnectMutation.error,
    isConnecting: connectMutation.isPending,
    isDisconnecting: disconnectMutation.isPending,
  };
}
