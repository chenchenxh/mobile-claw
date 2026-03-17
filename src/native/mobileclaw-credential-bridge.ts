/**
 * React Native JS-side bridge contract.
 * Real runtime binding:
 *   const { MobileClawCredentialModule } = NativeModules;
 */
export interface MobileClawCredentialBridge {
  saveEncrypted(providerId: string, payload: string): Promise<string>;
  startOAuth(providerId: string, authUrl: string): Promise<string>;
  revoke(credentialRef: string): Promise<string>;
}
