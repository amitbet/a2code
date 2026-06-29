import * as NodeCrypto from "node:crypto";

/**
 * Integrity + authenticity checks for downloaded hot-update payloads.
 *
 * The full app updater (electron-updater) verifies its packages for us; this
 * JS-only side channel bypasses it, so we must verify downloads ourselves
 * before extracting or executing them. We embed an Ed25519 public key in the
 * (signed, notarized) shell and require every payload manifest to carry a
 * base64 Ed25519 signature over the ASCII sha256-hex of the archive.
 *
 * Generate a keypair with OpenSSL (when built with Ed25519 support):
 *   openssl genpkey -algorithm ed25519 -out payload-signing.key
 *   openssl pkey -in payload-signing.key -pubout
 * or with Node (works everywhere):
 *   node -e 'const c=require("crypto");const {publicKey,privateKey}=c.generateKeyPairSync("ed25519");
 *     require("fs").writeFileSync("payload-signing.key",privateKey.export({type:"pkcs8",format:"pem"}));
 *     process.stdout.write(publicKey.export({type:"spki",format:"pem"}))'
 * Paste the public PEM below; keep the private key as the
 * `T3CODE_PAYLOAD_SIGNING_KEY` CI secret consumed by build-payload-asset.
 *
 * Empty here means "no embedded key": payload updates stay disabled in
 * production unless an unsigned/dev override is explicitly enabled.
 */
export const PAYLOAD_SIGNING_PUBLIC_KEY = "";

export function computeSha256Hex(data: Uint8Array): string {
  return NodeCrypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Verify a base64 Ed25519 signature over the ASCII sha256-hex string using the
 * given SPKI/PEM public key. Returns false on any malformed input rather than
 * throwing, so callers treat verification failures as a refused payload.
 */
export function verifyPayloadSignature(input: {
  readonly sha256Hex: string;
  readonly signatureBase64: string;
  readonly publicKeyPem: string;
}): boolean {
  if (input.publicKeyPem.trim().length === 0 || input.signatureBase64.trim().length === 0) {
    return false;
  }
  try {
    const publicKey = NodeCrypto.createPublicKey(input.publicKeyPem);
    return NodeCrypto.verify(
      null,
      Buffer.from(input.sha256Hex, "ascii"),
      publicKey,
      Buffer.from(input.signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}
