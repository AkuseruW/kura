export class BaseException extends Error {
	constructor(
		message: string,
		public code: string,
		public status: number = 500,
		public hint?: string,
		public docsUrl?: string
	) {
		super(message)
		this.name = this.constructor.name
		Error.captureStackTrace(this, this.constructor)
	}

	render(): void {
		console.error(`\n${this.name}: ${this.message}`)
		console.error(`Code: ${this.code}`)
		if (this.hint) {
			console.error(`Hint: ${this.hint}`)
		}
		if (this.docsUrl) {
			console.error(`Docs: ${this.docsUrl}`)
		}
		console.error('')
	}
}
