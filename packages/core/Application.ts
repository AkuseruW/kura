import { Config } from "./Config"
import { Container } from "./Container"
import { Env } from "./Env"

type AppState = 'created' | 'registered' | 'booted' | 'ready' | 'shutdown'

export interface ServiceProvider {
	register(app: Application): void | Promise<void>
	boot?(app: Application): void | Promise<void>
	shutdown?(app: Application): void | Promise<void>
}

export class Application {
	private state: AppState = 'created'
	private providers: ServiceProvider[] = []

	public container: Container
	public config: Config
	public env: Env

	constructor() {
		this.container = new Container()
		this.config = new Config()
		this.env = new Env()
	}

	register(provider: ServiceProvider): void {
		this.providers.push(provider)
	}

	async boot(): Promise<void> {
		this.state = 'registered'

		for (const provider of this.providers) {
			await provider.register(this)
		}

		this.state = 'booted'

		for (const provider of this.providers) {
			if (provider.boot) {
				await provider.boot(this)
			}
		}

		this.state = 'ready'
	}

	getState(): AppState {
		return this.state
	}

	async shutdown(): Promise<void> {
		this.state = 'shutdown'

		for (const provider of this.providers) {
			if (provider.shutdown) {
				await provider.shutdown(this)
			}
		}
	}
}
