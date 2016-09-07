'use strict';
var vscode_languageserver_1 = require('vscode-languageserver');
var url = require('url');
var path = require('path');
var fs = require('fs');
var globby = require('globby');
var jsonToAst = require('json-to-ast');
var connection = vscode_languageserver_1.createConnection(new vscode_languageserver_1.IPCMessageReader(process), new vscode_languageserver_1.IPCMessageWriter(process));
var documents = new vscode_languageserver_1.TextDocuments();
documents.listen(connection);
var workspaceRoot;
connection.onInitialize(function (params) {
    workspaceRoot = params.rootPath;
    return {
        capabilities: {
            textDocumentSync: documents.syncKind,
            completionProvider: {
                resolveProvider: true
            }
        }
    };
});
documents.onDidChangeContent(function (change) {
    console.log('change cont');
    // connection.console.log(`doc change ${change.document.uri}`);
});
connection.onDidOpenTextDocument(function (params) {
    connection.console.log("opening doc " + params.textDocument.uri);
});
connection.listen();
connection.onCompletion(function (params, token) {
    if (token.isCancellationRequested) {
        return [];
    }
    try {
        console.log('uris', documents.keys());
        console.log('DOC');
        console.log(documents.get(params.textDocument.uri).getText());
    }
    catch (e) {
        console.error(e);
    }
    var parsed = url.parse(params.textDocument.uri);
    if (path.basename(parsed.path) !== 'pattern.json') {
        return [];
    }
    return Promise.race([
        new Promise(function (resolve) {
            var disposable = token.onCancellationRequested(function () {
                disposable.dispose();
                resolve([]);
            });
        }),
        completionForPatternManifest(parsed.path, params.position)
    ])
        .then(function (winner) { return winner; });
});
function completionForPatternManifest(file, position) {
    return readText(file)
        .then(function (manifestText) { return getPatterns().then(function (paths) { return ({ manifestText: manifestText, patterns: paths }); }); })
        .then(function (_a) {
        var manifestText = _a.manifestText, patterns = _a.patterns;
        var range = getDependencyRange(manifestText, position);
        if (!range) {
            return [];
        }
        var editorRange = vscode_languageserver_1.Range.create(range.start.line - 1, range.start.column, range.end.line - 1, range.end.column - 2);
        return patterns
            .map(function (patternId) { return ({
            label: patternId,
            kind: vscode_languageserver_1.CompletionItemKind.Text,
            textEdit: vscode_languageserver_1.TextEdit.replace(editorRange, patternId)
        }); });
    });
}
function readText(file) {
    return new Promise(function (resolve, reject) {
        fs.readFile(file, function (err, data) {
            if (err) {
                return reject(err);
            }
            resolve(data.toString());
        });
    });
}
function readJson(file) {
    return readText(file).then(function (text) { return JSON.parse(text); });
}
function getPatterns() {
    return globby(['patterns/**/pattern.json'])
        .then(function (patterns) { return patterns.map(function (pattern) { return pattern.replace(/patterns\/(.+)\/pattern.json/, '$1'); }); });
}
function getDependencyRange(manifestText, position) {
    var ast = jsonToAst(manifestText);
    var dependencies = ast.properties
        .find(function (property) { return property.key.value === 'patterns'; });
    if (!dependencies) {
        return null;
    }
    if (dependencies.value.type !== 'object') {
        return null;
    }
    var dependencyValueRanges = dependencies.value.properties
        .map(function (property) { return property.value.position; });
    return dependencyValueRanges.find(function (range) { return isInsideRange(position, range); });
}
function isInsideRange(position, range) {
    var cursorLine = position.line + 1;
    var cursorColumn = position.character + 1;
    return cursorLine > range.start.line && cursorLine < range.end.line
        || cursorLine === range.start.line && cursorLine !== range.end.line && cursorColumn > range.start.column
        || cursorLine !== range.start.line && cursorLine === range.end.line && cursorColumn < range.end.column
        || cursorLine === range.start.line && cursorLine === range.end.line
            && cursorColumn > range.start.column && cursorColumn < range.end.column;
}
//# sourceMappingURL=server.js.map