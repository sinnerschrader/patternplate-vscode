declare module 'globby' {
	function globby(patterns: string[]): Promise<string[]>;
	namespace globby {}

	export = globby;
}
