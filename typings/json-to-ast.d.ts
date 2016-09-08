declare module 'json-to-ast' {

	function parse(code: string): parse.Object;
	namespace parse {
		interface Position {
			start: {
				line: number;
				column: number;
				char: number;
			},
			end: {
				line: number;
				column: number;
				char: number;
			}
		}
		interface Node {
			position: Position;
		}
		interface Object extends Node {
			type: 'object';
			properties: Property[];
		}
		interface String extends Node {
			type: 'string',
			value: string;
		}
		interface Property {
			type: 'property';
			key: PropertyKey;
			value: Object|String;
		}
		interface PropertyKey extends Node {
			type: 'key';
			value: string;
		}
	}

	export = parse;

}
