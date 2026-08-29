import { useMutation } from '@tanstack/react-query';
import * as mediaApi from '../api/endpoints/media';
import type { PickedFile } from '../api/endpoints/media';
import { captureHandledError } from '../lib/sentry';

export function useUploadMedia() {
  return useMutation({
    mutationFn: (vars: { whatsappPhoneNumberId: string; file: PickedFile }) =>
      mediaApi.uploadMedia(vars.whatsappPhoneNumberId, vars.file),
    onError: (err, vars) => {
      // The mime type and size are what distinguish "our upload path is
      // broken" from "someone sent a 90MB video Meta refuses". The file's
      // name and uri are left out: a filename is user content.
      captureHandledError(err, {
        stage: 'uploadMedia',
        mimeType: vars.file.mimeType,
      });
    },
  });
}
