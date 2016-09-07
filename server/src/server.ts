'use strict';

import * as vscode from 'vscode';
import {
	IPCMessageReader,
	IPCMessageWriter,
	createConnection,
	IConnection,
	TextDocuments,
	TextDocumentPositionParams,
	Range,
	Position,
	CompletionItem,
	CompletionItemKind,
	TextEdit
} from 'vscode-languageserver';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as globby from 'globby';
import * as jsonToAst from 'json-to-ast';

let connection: IConnection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));

let documents: TextDocuments = new TextDocuments();
documents.listen(connection);

let workspaceRoot: string;
connection.onInitialize(params => {
	workspaceRoot = params.rootPath;
	return {
		capabilities: {
			textDocumentSync: documents.syncKind,
			completionProvider: {
				resolveProvider: true
			}
		}
	}
});

documents.onDidChangeContent(change => {
	console.log('change cont');
	// connection.console.log(`doc change ${change.document.uri}`);
});

connection.onDidOpenTextDocument(params => {
	connection.console.log(`opening doc ${params.textDocument.uri}`);
});

connection.listen();

connection.onCompletion((params: TextDocumentPositionParams,
		token: vscode.CancellationToken): CompletionItem[] | Promise<CompletionItem[]> => {
	if (token.isCancellationRequested) {
		return [];
	}
	try {
		console.log('uris', documents.keys());
		console.log('DOC');
		console.log(documents.get(params.textDocument.uri).getText());
	} catch (e) {
		console.error(e);
	}
	const parsed = url.parse(params.textDocument.uri);
	if (path.basename(parsed.path) !== 'pattern.json') {
		return [];
	}
	return Promise.race([
		new Promise(resolve => {
			const disposable = token.onCancellationRequested(() => {
				disposable.dispose();
				resolve([]);
			});
		}),
		completionForPatternManifest(parsed.path, params.position)
	])
	.then(winner => winner);
});

function completionForPatternManifest(file: string, position: Position): Promise<CompletionItem[]> {
	return readText(file)
		.then(manifestText => getPatterns().then(paths => ({manifestText, patterns: paths})))
		.then(({manifestText, patterns}) => {
			const range = getDependencyRange(manifestText, position);
			if (!range) {
				return [];
			}
			const editorRange = Range.create(range.start.line - 1, range.start.column,
				range.end.line - 1, range.end.column - 2);
			return patterns
				.map(patternId => ({
					label: patternId,
					kind: CompletionItemKind.Text,
					textEdit: TextEdit.replace(editorRange, patternId)
				} as CompletionItem));
		});
}

function readText(file: string): Promise<string> {
	return new Promise((resolve, reject) => {
		fs.readFile(file, (err, data) => {
			if (err) {
				return reject(err);
			}
			resolve(data.toString());
		});
	});
}

function readJson(file: string): Promise<any> {
	return readText(file).then(text => JSON.parse(text));
}

function getPatterns(): Promise<string[]> {
	return globby(['patterns/**/pattern.json'])
		.then(patterns => patterns.map(pattern => pattern.replace(/patterns\/(.+)\/pattern.json/, '$1')));
}

function getDependencyRange(manifestText: string, position: Position): jsonToAst.Position {
	const ast = jsonToAst(manifestText);
	const dependencies = ast.properties
		.find(property => property.key.value === 'patterns');
	if (!dependencies) {
		return null;
	}
	if (dependencies.value.type !== 'object') {
		return null;
	}
	const dependencyValueRanges = (dependencies.value as jsonToAst.Object).properties
		.map(property => property.value.position);
	return dependencyValueRanges.find(range => isInsideRange(position, range));
}

function isInsideRange(position: Position, range: jsonToAst.Position): boolean {
	const cursorLine = position.line + 1;
	const cursorColumn = position.character + 1;
	return cursorLine > range.start.line && cursorLine < range.end.line
			|| cursorLine === range.start.line && cursorLine !== range.end.line && cursorColumn > range.start.column
			|| cursorLine !== range.start.line && cursorLine === range.end.line && cursorColumn < range.end.column
			|| cursorLine === range.start.line && cursorLine === range.end.line
				&& cursorColumn > range.start.column && cursorColumn < range.end.column;
}
