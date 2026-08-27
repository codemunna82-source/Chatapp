import { useMutation } from '@tanstack/react-query';
import * as mediaApi from '../api/endpoints/media';
import type { PickedFile } from '../api/endpoints/media';

export function useUploadMedia() {
  return useMutation({
    mutationFn: (vars: { whatsappPhoneNumberId: string; file: PickedFile }) =>
      mediaApi.uploadMedia(vars.whatsappPhoneNumberId, vars.file),
  });
}
