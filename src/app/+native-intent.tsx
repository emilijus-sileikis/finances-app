import { getShareExtensionKey } from 'expo-share-intent';

/**
 * Redirects incoming Android/iOS Share Intent deep links straight to /scan
 * so Expo Router never flashes an "Unmatched Route" screen.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  try {
    if (
      path.includes(`dataUrl=${getShareExtensionKey()}`) ||
      path.includes('dataUrl=')
    ) {
      return '/scan';
    }
    return path;
  } catch {
    return '/';
  }
}
