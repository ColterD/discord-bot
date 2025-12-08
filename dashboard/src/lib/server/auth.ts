/**
 * Discord OAuth Authentication
 *
 * Handles Discord OAuth2 flow for dashboard authentication.
 * Restricts access to bot owners/admins defined in environment variables.
 *
 * Session storage: Uses Valkey for production, in-memory fallback for dev.
 */

import Valkey from 'iovalkey';
import { dev } from '$app/environment';

/** Discord OAuth2 endpoints */
const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_AUTH_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

/** OAuth scopes needed */
const SCOPES = ['identify'];

/** Session cookie name */
export const SESSION_COOKIE = 'dashboard_session';

/** Session duration (24 hours) */
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

/** Session key prefix for Valkey */
const SESSION_KEY_PREFIX = 'dashboard:session:';

/** In-memory fallback for when Valkey is unavailable */
const memoryStore = new Map<string, Session>();

/** Valkey client - lazy initialized */
let valkeyClient: Valkey | null = null;
let valkeyConnected = false;
let valkeyInitialized = false;

/**
 * Initialize Valkey client
 */
async function initValkey(): Promise<void> {
	if (valkeyInitialized) return;
	valkeyInitialized = true;

	const valkeyUrl = process.env.VALKEY_URL;
	if (!valkeyUrl) {
		console.log('[Auth] No VALKEY_URL configured, using in-memory session storage');
		return;
	}

	try {
		valkeyClient = new Valkey(valkeyUrl, {
			retryStrategy: (times: number) => {
				if (times > 3) return null;
				return Math.min(times * 200, 2000);
			},
			maxRetriesPerRequest: 3,
			lazyConnect: true
		});

		valkeyClient.on('connect', () => {
			valkeyConnected = true;
			console.log('[Auth] Connected to Valkey for session storage');
		});

		valkeyClient.on('error', (err: Error) => {
			valkeyConnected = false;
			console.warn('[Auth] Valkey error, using fallback:', err.message);
		});

		valkeyClient.on('close', () => {
			valkeyConnected = false;
		});

		await valkeyClient.connect();
		valkeyConnected = true;
	} catch (error) {
		console.warn('[Auth] Valkey unavailable, using in-memory fallback:', error);
		valkeyClient = null;
	}
}

// Initialize on module load
await initValkey();

export interface Session {
	userId: string;
	username: string;
	discriminator: string;
	avatar: string | null;
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	createdAt: number;
}

export interface DiscordUser {
	id: string;
	username: string;
	discriminator: string;
	avatar: string | null;
	bot?: boolean;
	system?: boolean;
	mfa_enabled?: boolean;
	banner?: string | null;
	accent_color?: number | null;
	locale?: string;
	verified?: boolean;
	email?: string | null;
	flags?: number;
	premium_type?: number;
	public_flags?: number;
}

interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token: string;
	scope: string;
}

/**
 * Get OAuth configuration from environment
 */
function getOAuthConfig() {
	const clientId = process.env.DISCORD_CLIENT_ID;
	const clientSecret = process.env.DISCORD_CLIENT_SECRET;
	const redirectUri = process.env.DASHBOARD_URL
		? `${process.env.DASHBOARD_URL}/auth/callback`
		: 'http://localhost:3000/auth/callback';

	if (!clientId || !clientSecret) {
		throw new Error('Missing DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET environment variables');
	}

	return { clientId, clientSecret, redirectUri };
}

/**
 * Get allowed user IDs from environment
 */
function getAllowedUserIds(): Set<string> {
	const ownerIds = (process.env.BOT_OWNER_IDS ?? '').split(',').filter(Boolean);
	const adminIds = (process.env.BOT_ADMIN_IDS ?? '').split(',').filter(Boolean);
	return new Set([...ownerIds, ...adminIds]);
}

/**
 * Generate OAuth2 authorization URL
 */
export function getAuthUrl(state: string): string {
	const { clientId, redirectUri } = getOAuthConfig();

	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: 'code',
		scope: SCOPES.join(' '),
		state
	});

	return `${DISCORD_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCode(code: string): Promise<TokenResponse> {
	const { clientId, clientSecret, redirectUri } = getOAuthConfig();

	const response = await fetch(DISCORD_TOKEN_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri
		})
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Failed to exchange code: ${error}`);
	}

	return response.json();
}

/**
 * Fetch user info from Discord
 */
export async function fetchUser(accessToken: string): Promise<DiscordUser> {
	const response = await fetch(`${DISCORD_API}/users/@me`, {
		headers: {
			Authorization: `Bearer ${accessToken}`
		}
	});

	if (!response.ok) {
		throw new Error('Failed to fetch user info');
	}

	return response.json();
}

/**
 * Check if user is authorized to access dashboard
 */
export function isAuthorized(userId: string): boolean {
	const allowedIds = getAllowedUserIds();

	// If no IDs configured, deny all (fail secure)
	if (allowedIds.size === 0) {
		console.warn('[Auth] No BOT_OWNER_IDS or BOT_ADMIN_IDS configured - denying all access');
		return false;
	}

	return allowedIds.has(userId);
}

/**
 * Generate a random session ID
 */
function generateSessionId(): string {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Store session in Valkey or memory
 */
async function storeSession(sessionId: string, session: Session): Promise<void> {
	if (valkeyConnected && valkeyClient) {
		try {
			const ttlMs = session.expiresAt - Date.now();
			await valkeyClient.set(
				SESSION_KEY_PREFIX + sessionId,
				JSON.stringify(session),
				'PX',
				ttlMs
			);
			return;
		} catch (error) {
			console.warn('[Auth] Valkey store failed, using memory:', error);
		}
	}

	memoryStore.set(sessionId, session);
}

/**
 * Retrieve session from Valkey or memory
 */
async function retrieveSession(sessionId: string): Promise<Session | null> {
	if (valkeyConnected && valkeyClient) {
		try {
			const data = await valkeyClient.get(SESSION_KEY_PREFIX + sessionId);
			if (data) {
				return JSON.parse(data) as Session;
			}
			return null;
		} catch (error) {
			console.warn('[Auth] Valkey get failed, checking memory:', error);
		}
	}

	return memoryStore.get(sessionId) ?? null;
}

/**
 * Remove session from Valkey or memory
 */
async function removeSession(sessionId: string): Promise<void> {
	if (valkeyConnected && valkeyClient) {
		try {
			await valkeyClient.del(SESSION_KEY_PREFIX + sessionId);
		} catch (error) {
			console.warn('[Auth] Valkey delete failed:', error);
		}
	}

	memoryStore.delete(sessionId);
}

/**
 * Create a new session
 */
export async function createSession(
	user: DiscordUser,
	tokens: TokenResponse
): Promise<{ sessionId: string; session: Session }> {
	const sessionId = generateSessionId();
	const now = Date.now();

	const session: Session = {
		userId: user.id,
		username: user.username,
		discriminator: user.discriminator,
		avatar: user.avatar,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresAt: now + SESSION_DURATION_MS,
		createdAt: now
	};

	await storeSession(sessionId, session);

	// Cleanup expired sessions from memory (Valkey handles its own TTL)
	cleanupExpiredSessions();

	return { sessionId, session };
}

/**
 * Get session by ID
 */
export async function getSession(sessionId: string): Promise<Session | null> {
	const session = await retrieveSession(sessionId);

	if (!session) {
		return null;
	}

	// Check if expired
	if (Date.now() > session.expiresAt) {
		await removeSession(sessionId);
		return null;
	}

	return session;
}

/**
 * Delete session (logout)
 */
export async function deleteSession(sessionId: string): Promise<void> {
	await removeSession(sessionId);
}

/**
 * Clean up expired sessions from memory store
 * (Valkey handles TTL automatically)
 */
function cleanupExpiredSessions(): void {
	const now = Date.now();
	for (const [id, session] of memoryStore) {
		if (now > session.expiresAt) {
			memoryStore.delete(id);
		}
	}
}

/**
 * Get session cookie options
 */
export function getSessionCookieOptions() {
	return {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax' as const,
		maxAge: SESSION_DURATION_MS / 1000 // seconds
	};
}

/**
 * Get user's avatar URL
 */
export function getAvatarUrl(user: Pick<Session, 'userId' | 'avatar'>): string {
	if (user.avatar) {
		return `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatar}.png`;
	}
	// Default Discord avatar
	const defaultIndex = Number.parseInt(user.userId, 10) % 5;
	return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}
