/**
 * Type declarations for @ika.xyz/sdk
 * The package provides runtime types but lacks complete TypeScript declarations
 */

declare module '@ika.xyz/sdk' {
	import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
	import { Transaction } from '@mysten/sui/transactions';

	export enum Curve {
		SECP256K1 = 'SECP256K1',
		SECP256R1 = 'SECP256R1',
		ED25519 = 'ED25519',
		RISTRETTO = 'RISTRETTO',
	}

	export enum SignatureAlgorithm {
		ECDSASecp256k1 = 'ECDSASecp256k1',
		ECDSASecp256r1 = 'ECDSASecp256r1',
		EdDSA = 'EdDSA',
	}

	export enum Hash {
		SHA256 = 'SHA256',
		SHA512 = 'SHA512',
		BLAKE2b256 = 'BLAKE2b256',
	}

	export interface NetworkConfig {
		packages: {
			ikaPackage: string;
			ikaCommonPackage: string;
			ikaSystemPackage: string;
			ikaDwallet2pcMpcPackage: string;
		};
		objects: {
			ikaSystemObject: { objectID: string };
			ikaDWalletCoordinator: {
				objectID: string;
				initialSharedVersion: number;
			};
		};
	}

	export function getNetworkConfig(network: 'testnet' | 'mainnet'): NetworkConfig;

	export class IkaClient {
		constructor(config: {
			suiClient: SuiJsonRpcClient;
			config: NetworkConfig;
			cache?: boolean;
		});
		initialize(): Promise<void>;
		getLatestNetworkEncryptionKey(): Promise<any>;
		getDWallet(dwalletId: string): Promise<any>;
		getDWalletInParticularState(dwalletId: string, state: string): Promise<any>;
		getPresignInParticularState(presignId: string, state: string): Promise<any>;
	}

	export class IkaTransaction {
		constructor(config: {
			ikaClient: IkaClient;
			transaction: Transaction;
			userShareEncryptionKeys?: UserShareEncryptionKeys;
		});
		registerEncryptionKey(config: { curve: Curve }): Promise<void>;
		registerSessionIdentifier(identifier: Uint8Array): any;
		requestDWalletDKG(config: any): Promise<[any, any]>;
		verifyPresignCap(config: { presign: any }): any;
	}

	export class UserShareEncryptionKeys {
		static fromRootSeedKey(
			seed: Uint8Array,
			curve: Curve
		): Promise<UserShareEncryptionKeys>;
	}

	export function createRandomSessionIdentifier(): Uint8Array;
	export function prepareDKGAsync(
		ikaClient: IkaClient,
		curve: Curve,
		keys: UserShareEncryptionKeys,
		identifier: Uint8Array,
		signerAddress: string
	): Promise<any>;
	export function publicKeyFromDWalletOutput(
		curve: Curve,
		output: Uint8Array
	): Promise<string>;
	export function createUserSignMessageWithPublicOutput(
		message: Uint8Array
	): Promise<any>;
	export function parseSignatureFromSignOutput(output: any): Promise<any>;
	export function prepareImportedKeyDWalletVerification(config: any): Promise<any>;
}
