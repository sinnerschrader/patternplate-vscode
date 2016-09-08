export interface Message {
	type: string;
}

export interface Log extends Message {
	type: 'log';
	args: string[];
}

export interface Error extends Message {
	type: 'error';
	error: string;
}

export interface Start extends Message {
	type: 'start';
	cwd: string;
}

export interface Started extends Message {
	type: 'started';
	port: string;
}
