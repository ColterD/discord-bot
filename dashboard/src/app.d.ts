// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			user?: {
				id: string;
				username: string;
				avatar: string | null;
			};
		}

		interface PageData {
			user?: {
				id: string;
				username: string;
				avatar: string | null;
			};
		}

		interface Error {
			message: string;
			errorId?: string;
		}

		// interface PageState {}
		// interface Platform {}
	}
}

export {};
