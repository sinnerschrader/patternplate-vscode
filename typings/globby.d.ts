declare module 'globby' {

	interface Opts {
		cwd: string
	}
	function globby(patterns: string[], opts?: Opts): Promise<string[]>;
	namespace globby {}

	export = globby;

}
