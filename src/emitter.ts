import * as ts from 'typescript';
import { IdentifierResolver } from './resolvers';
import { Helpers } from './helpers';
import { Preprocessor } from './preprocessor';
import { CodeWriter } from './codewriter';

export class Emitter {
    public writer: CodeWriter;
    private resolver: IdentifierResolver;
    private preprocessor: Preprocessor;
    private sourceFileName: string;
    private jsLib: boolean;
    private scope: Array<ts.Node> = new Array<ts.Node>();
    private opsMap: Map<number, string> = new Map<number, string>();

    public constructor(
        typeChecker: ts.TypeChecker, private options: ts.CompilerOptions,
        private cmdLineOptions: any, private singleModule: boolean, private rootFolder?: string) {

        this.writer = new CodeWriter();
        this.resolver = new IdentifierResolver(typeChecker);
        this.preprocessor = new Preprocessor(this.resolver);

        this.jsLib = (
            options
            && options.lib
            && options.lib.some(l => /lib.es\d+.d.ts/.test(l))
            && !options.lib.some(l => /lib.es5.d.ts/.test(l))
            || cmdLineOptions.jslib)
            ? true
            : false;

        this.opsMap[ts.SyntaxKind.EqualsToken] = '=';
        this.opsMap[ts.SyntaxKind.PlusToken] = '+';
        this.opsMap[ts.SyntaxKind.MinusToken] = '-';
        this.opsMap[ts.SyntaxKind.AsteriskToken] = '*';
        this.opsMap[ts.SyntaxKind.PercentToken] = '%';
        this.opsMap[ts.SyntaxKind.AsteriskAsteriskToken] = '**';
        this.opsMap[ts.SyntaxKind.SlashToken] = '/';
        this.opsMap[ts.SyntaxKind.AmpersandToken] = '&';
        this.opsMap[ts.SyntaxKind.BarToken] = '|';
        this.opsMap[ts.SyntaxKind.CaretToken] = '^';
        this.opsMap[ts.SyntaxKind.LessThanLessThanToken] = '<<';
        this.opsMap[ts.SyntaxKind.GreaterThanGreaterThanToken] = '>>';
        this.opsMap[ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken] = '__shiftRightInt';
        this.opsMap[ts.SyntaxKind.EqualsEqualsToken] = '==';
        this.opsMap[ts.SyntaxKind.EqualsEqualsEqualsToken] = '__strictEquals';
        this.opsMap[ts.SyntaxKind.LessThanToken] = '<';
        this.opsMap[ts.SyntaxKind.LessThanEqualsToken] = '<=';
        this.opsMap[ts.SyntaxKind.ExclamationEqualsToken] = '!=';
        this.opsMap[ts.SyntaxKind.ExclamationEqualsEqualsToken] = '__strictNotEquals';
        this.opsMap[ts.SyntaxKind.GreaterThanToken] = '>';
        this.opsMap[ts.SyntaxKind.GreaterThanEqualsToken] = '>=';

        this.opsMap[ts.SyntaxKind.PlusEqualsToken] = '+=';
        this.opsMap[ts.SyntaxKind.MinusEqualsToken] = '-=';
        this.opsMap[ts.SyntaxKind.AsteriskEqualsToken] = '*=';
        this.opsMap[ts.SyntaxKind.PercentEqualsToken] = '%=';
        this.opsMap[ts.SyntaxKind.AsteriskAsteriskEqualsToken] = '**=';
        this.opsMap[ts.SyntaxKind.SlashEqualsToken] = '/=';
        this.opsMap[ts.SyntaxKind.AmpersandEqualsToken] = '&=';
        this.opsMap[ts.SyntaxKind.BarEqualsToken] = '|=';
        this.opsMap[ts.SyntaxKind.CaretEqualsToken] = '^=';
        this.opsMap[ts.SyntaxKind.LessThanLessThanEqualsToken] = '<<=';
        this.opsMap[ts.SyntaxKind.GreaterThanGreaterThanEqualsToken] = '>>=';
        this.opsMap[ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken] = '__strictNotEqualsAssign';

        this.opsMap[ts.SyntaxKind.ExclamationToken] = '!';
        this.opsMap[ts.SyntaxKind.PlusPlusToken] = '++';
        this.opsMap[ts.SyntaxKind.MinusMinusToken] = '--';
    }

    public get isGlobalScope() {
        return this.scope.length > 0 && this.scope[this.scope.length - 1].kind === ts.SyntaxKind.SourceFile;
    }

    public printNode(node: ts.Statement): string {
        const sourceFile = ts.createSourceFile(
            'noname', '', ts.ScriptTarget.ES2018, /*setParentNodes */ true, ts.ScriptKind.TS);

        (<any>sourceFile.statements) = [node];

        // debug output
        const emitter = ts.createPrinter({
            newLine: ts.NewLineKind.LineFeed,
        });

        const result = emitter.printNode(ts.EmitHint.SourceFile, sourceFile, sourceFile);
        return result;
    }

    public processNode(node: ts.Node): void {
        switch (node.kind) {
            case ts.SyntaxKind.SourceFile:
                this.processFile(<ts.SourceFile>node);
                break;
            case ts.SyntaxKind.Bundle:
                this.processBundle(<ts.Bundle>node);
                break;
            case ts.SyntaxKind.UnparsedSource:
                this.processUnparsedSource(<ts.UnparsedSource>node);
                break;
            default:
                // TODO: finish it
                throw new Error('Method not implemented.');
        }
    }

    public save() {
        // TODO: ...
    }

    private processFunction(
        location: ts.Node,
        statements: ts.NodeArray<ts.Statement>,
        parameters: ts.NodeArray<ts.ParameterDeclaration>): void {

        this.scope.push(location);

        this.processFunctionWithinContext(location, statements, parameters);

        this.scope.pop();
    }

    private processFunctionWithinContext(
        location: ts.Node,
        statements: ts.NodeArray<ts.Statement>,
        parameters: ts.NodeArray<ts.ParameterDeclaration>) {

        statements.forEach(s => {
            this.processStatement(s);
        });
    }

    private isDeclarationStatement(f: ts.Statement): boolean {
        if (f.kind === ts.SyntaxKind.FunctionDeclaration
            || f.kind === ts.SyntaxKind.EnumDeclaration
            || f.kind === ts.SyntaxKind.ClassDeclaration) {
            return true;
        }

        return false;
    }

    private isGlobalVarDeclaration(f: ts.Statement): boolean {
        if (f.kind === ts.SyntaxKind.VariableStatement) {
            const variableStatement = <ts.VariableStatement>f;
            if (Helpers.isConstOrLet(variableStatement.declarationList)) {
                return false;
            }

            return true;
        }

        return false;
    }

    private processFile(sourceFile: ts.SourceFile): void {
        this.sourceFileName = sourceFile.fileName;

        this.scope.push(sourceFile);

        // added header
        this.writer.writeStringNewLine(`#include "core.h"`);
        this.writer.writeStringNewLine('');
        this.writer.writeStringNewLine('using namespace js;');
        this.writer.writeStringNewLine('');

        sourceFile.statements.filter(f => this.isDeclarationStatement(f) || this.isGlobalVarDeclaration(f)).forEach(s => {
            this.processStatement(s);
        });

        this.scope.pop();

        this.writer.writeStringNewLine('');
        this.writer.writeStringNewLine('int main(int argc, char** argv)');
        this.writer.BeginBlock();

        sourceFile.statements.filter(f => !this.isDeclarationStatement(f)).forEach(s => {
            this.processStatement(s);
        });

        this.writer.writeStringNewLine('');
        this.writer.writeStringNewLine('return 0;');
        this.writer.EndBlock();
    }

    private processBundle(bundle: ts.Bundle): void {
        throw new Error('Method not implemented.');
    }

    private processUnparsedSource(unparsedSource: ts.UnparsedSource): void {
        throw new Error('Method not implemented.');
    }

    private processStatement(node: ts.Statement): void {
        this.processStatementInternal(node);
    }

    private processStatementInternal(nodeIn: ts.Statement): void {
        const node = this.preprocessor.preprocessStatement(nodeIn);

        switch (node.kind) {
            case ts.SyntaxKind.EmptyStatement: return;
            case ts.SyntaxKind.VariableStatement: this.processVariableStatement(<ts.VariableStatement>node); return;
            case ts.SyntaxKind.FunctionDeclaration: this.processFunctionDeclaration(<ts.FunctionDeclaration>node); return;
            case ts.SyntaxKind.Block: this.processBlock(<ts.Block>node); return;
            case ts.SyntaxKind.ModuleBlock: this.processModuleBlock(<ts.ModuleBlock>node); return;
            case ts.SyntaxKind.ReturnStatement: this.processReturnStatement(<ts.ReturnStatement>node); return;
            case ts.SyntaxKind.IfStatement: this.processIfStatement(<ts.IfStatement>node); return;
            case ts.SyntaxKind.DoStatement: this.processDoStatement(<ts.DoStatement>node); return;
            case ts.SyntaxKind.WhileStatement: this.processWhileStatement(<ts.WhileStatement>node); return;
            case ts.SyntaxKind.ForStatement: this.processForStatement(<ts.ForStatement>node); return;
            case ts.SyntaxKind.ForInStatement: this.processForInStatement(<ts.ForInStatement>node); return;
            case ts.SyntaxKind.ForOfStatement: this.processForOfStatement(<ts.ForOfStatement>node); return;
            case ts.SyntaxKind.BreakStatement: this.processBreakStatement(<ts.BreakStatement>node); return;
            case ts.SyntaxKind.ContinueStatement: this.processContinueStatement(<ts.ContinueStatement>node); return;
            case ts.SyntaxKind.SwitchStatement: this.processSwitchStatement(<ts.SwitchStatement>node); return;
            case ts.SyntaxKind.ExpressionStatement: this.processExpressionStatement(<ts.ExpressionStatement>node); return;
            case ts.SyntaxKind.TryStatement: this.processTryStatement(<ts.TryStatement>node); return;
            case ts.SyntaxKind.ThrowStatement: this.processThrowStatement(<ts.ThrowStatement>node); return;
            case ts.SyntaxKind.DebuggerStatement: this.processDebuggerStatement(<ts.DebuggerStatement>node); return;
            case ts.SyntaxKind.EnumDeclaration: this.processEnumDeclaration(<ts.EnumDeclaration>node); return;
            case ts.SyntaxKind.ClassDeclaration: this.processClassDeclaration(<ts.ClassDeclaration>node); return;
            case ts.SyntaxKind.ExportDeclaration: this.processExportDeclaration(<ts.ExportDeclaration>node); return;
            case ts.SyntaxKind.ImportDeclaration: this.processImportDeclaration(<ts.ImportDeclaration>node); return;
            case ts.SyntaxKind.ModuleDeclaration: this.processModuleDeclaration(<ts.ModuleDeclaration>node); return;
            case ts.SyntaxKind.NamespaceExportDeclaration: this.processNamespaceDeclaration(<ts.NamespaceDeclaration>node); return;
            case ts.SyntaxKind.InterfaceDeclaration: /*nothing to do*/ return;
            case ts.SyntaxKind.TypeAliasDeclaration: /*nothing to do*/ return;
            case ts.SyntaxKind.ExportAssignment: /*nothing to do*/ return;
        }

        // TODO: finish it
        throw new Error('Method not implemented.');
    }

    private processExpression(nodeIn: ts.Expression): void {
        const node = this.preprocessor.preprocessExpression(nodeIn);

        // we need to process it for statements only
        //// this.functionContext.code.setNodeToTrackDebugInfo(node, this.sourceMapGenerator);

        switch (node.kind) {
            case ts.SyntaxKind.NewExpression: this.processNewExpression(<ts.NewExpression>node); return;
            case ts.SyntaxKind.CallExpression: this.processCallExpression(<ts.CallExpression>node); return;
            case ts.SyntaxKind.PropertyAccessExpression: this.processPropertyAccessExpression(<ts.PropertyAccessExpression>node); return;
            case ts.SyntaxKind.PrefixUnaryExpression: this.processPrefixUnaryExpression(<ts.PrefixUnaryExpression>node); return;
            case ts.SyntaxKind.PostfixUnaryExpression: this.processPostfixUnaryExpression(<ts.PostfixUnaryExpression>node); return;
            case ts.SyntaxKind.BinaryExpression: this.processBinaryExpression(<ts.BinaryExpression>node); return;
            case ts.SyntaxKind.ConditionalExpression: this.processConditionalExpression(<ts.ConditionalExpression>node); return;
            case ts.SyntaxKind.DeleteExpression: this.processDeleteExpression(<ts.DeleteExpression>node); return;
            case ts.SyntaxKind.TypeOfExpression: this.processTypeOfExpression(<ts.TypeOfExpression>node); return;
            case ts.SyntaxKind.FunctionExpression: this.processFunctionExpression(<ts.FunctionExpression>node); return;
            case ts.SyntaxKind.ArrowFunction: this.processArrowFunction(<ts.ArrowFunction>node); return;
            case ts.SyntaxKind.ElementAccessExpression: this.processElementAccessExpression(<ts.ElementAccessExpression>node); return;
            case ts.SyntaxKind.ParenthesizedExpression: this.processParenthesizedExpression(<ts.ParenthesizedExpression>node); return;
            case ts.SyntaxKind.TypeAssertionExpression: this.processTypeAssertionExpression(<ts.TypeAssertion>node); return;
            case ts.SyntaxKind.VariableDeclarationList: this.processVariableDeclarationList(<ts.VariableDeclarationList><any>node); return;
            case ts.SyntaxKind.TrueKeyword:
            case ts.SyntaxKind.FalseKeyword: this.processBooleanLiteral(<ts.BooleanLiteral>node); return;
            case ts.SyntaxKind.NullKeyword: this.processNullLiteral(<ts.NullLiteral>node); return;
            case ts.SyntaxKind.NumericLiteral: this.processNumericLiteral(<ts.NumericLiteral>node); return;
            case ts.SyntaxKind.StringLiteral: this.processStringLiteral(<ts.StringLiteral>node); return;
            case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
                this.processNoSubstitutionTemplateLiteral(<ts.NoSubstitutionTemplateLiteral>node); return;
            case ts.SyntaxKind.ObjectLiteralExpression: this.processObjectLiteralExpression(<ts.ObjectLiteralExpression>node); return;
            case ts.SyntaxKind.TemplateExpression: this.processTemplateExpression(<ts.TemplateExpression>node); return;
            case ts.SyntaxKind.ArrayLiteralExpression: this.processArrayLiteralExpression(<ts.ArrayLiteralExpression>node); return;
            case ts.SyntaxKind.RegularExpressionLiteral: this.processRegularExpressionLiteral(<ts.RegularExpressionLiteral>node); return;
            case ts.SyntaxKind.ThisKeyword: this.processThisExpression(<ts.ThisExpression>node); return;
            case ts.SyntaxKind.SuperKeyword: this.processSuperExpression(<ts.SuperExpression>node); return;
            case ts.SyntaxKind.VoidExpression: this.processVoidExpression(<ts.VoidExpression>node); return;
            case ts.SyntaxKind.NonNullExpression: this.processNonNullExpression(<ts.NonNullExpression>node); return;
            case ts.SyntaxKind.AsExpression: this.processAsExpression(<ts.AsExpression>node); return;
            case ts.SyntaxKind.SpreadElement: this.processSpreadElement(<ts.SpreadElement>node); return;
            case ts.SyntaxKind.AwaitExpression: this.processAwaitExpression(<ts.AwaitExpression>node); return;
            case ts.SyntaxKind.Identifier: this.processIndentifier(<ts.Identifier>node); return;
        }

        // TODO: finish it
        throw new Error('Method not implemented.');
    }

    private processExpressionStatement(node: ts.ExpressionStatement): void {
        this.processExpression(node.expression);
        this.writer.EndOfStatement();
    }

    private fixupParentReferences<T extends ts.Node>(rootNode: T, setParent?: ts.Node): T {
        let parent: ts.Node = rootNode;
        if (setParent) {
            rootNode.parent = setParent;
        }

        ts.forEachChild(rootNode, visitNode);

        return rootNode;

        function visitNode(n: ts.Node): void {
            // walk down setting parents that differ from the parent we think it should be.  This
            // allows us to quickly bail out of setting parents for subtrees during incremental
            // parsing
            if (n.parent !== parent) {
                n.parent = parent;

                const saveParent = parent;
                parent = n;
                ts.forEachChild(n, visitNode);

                parent = saveParent;
            }
        }
    }

    private transpileTSNode(node: ts.Node, transformText?: (string) => string) {
        return this.transpileTSCode(node.getFullText(), transformText);
    }

    private transpileTSCode(code: string, transformText?: (string) => string) {

        const opts = {
            module: ts.ModuleKind.CommonJS,
            alwaysStrict: false,
            noImplicitUseStrict: true,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            target: ts.ScriptTarget.ES5
        };

        const result = ts.transpileModule(code, { compilerOptions: opts });

        let jsText = result.outputText;
        if (transformText) {
            jsText = transformText(jsText);
        }

        return this.parseJSCode(jsText);
    }

    private parseTSCode(jsText: string) {

        const opts = {
            module: ts.ModuleKind.CommonJS,
            alwaysStrict: false,
            noImplicitUseStrict: true,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            target: ts.ScriptTarget.ES5
        };

        const sourceFile = ts.createSourceFile(
            this.sourceFileName, jsText, ts.ScriptTarget.ES5, /*setParentNodes */ true, ts.ScriptKind.TS);
        // needed to make typeChecker to work properly
        (<any>ts).bindSourceFile(sourceFile, opts);
        return sourceFile.statements;
    }

    private bind(node: ts.Statement) {

        const opts = {
            module: ts.ModuleKind.CommonJS,
            alwaysStrict: false,
            noImplicitUseStrict: true,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            target: ts.ScriptTarget.ES5
        };

        const sourceFile = ts.createSourceFile(
            this.sourceFileName, '', ts.ScriptTarget.ES5, /*setParentNodes */ true, ts.ScriptKind.TS);

        (<any>sourceFile.statements) = [node];

        (<any>ts).bindSourceFile(sourceFile, opts);

        return sourceFile.statements[0];
    }

    private parseJSCode(jsText: string) {

        const opts = {
            module: ts.ModuleKind.CommonJS,
            alwaysStrict: false,
            noImplicitUseStrict: true,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            target: ts.ScriptTarget.ES5
        };

        const sourceFile = ts.createSourceFile('partial', jsText, ts.ScriptTarget.ES5, /*setParentNodes */ true);
        // nneded to make typeChecker to work properly
        (<any>ts).bindSourceFile(sourceFile, opts);
        return sourceFile.statements;
    }

    private processTSNode(node: ts.Node, transformText?: (string) => string) {
        const statements = this.transpileTSNode(node, transformText);

        if (statements && statements.length === 1 && (<any>statements[0]).expression) {
            this.processExpression((<any>statements[0]).expression);
            return;
        }

        statements.forEach(s => {
            this.processStatementInternal(s);
        });
    }

    private processTSCode(code: string, parse?: any) {
        const statements = (!parse) ? this.transpileTSCode(code) : this.parseTSCode(code);
        statements.forEach(s => {
            this.processStatementInternal(s);
        });
    }

    private processJSCode(code: string) {
        const statements = this.parseJSCode(code);
        statements.forEach(s => {
            this.processStatementInternal(s);
        });
    }

    private processTryStatement(node: ts.TryStatement): void {
        this.writer.writeStringNewLine('try');
        this.processStatement(node.tryBlock);
        if (node.catchClause) {
            this.writer.writeStringNewLine('catch (const any& ');
            if (node.catchClause.variableDeclaration.name.kind === ts.SyntaxKind.Identifier) {
            this.processVariableDeclarationOne(
                <ts.Identifier>(node.catchClause.variableDeclaration.name),
                node.catchClause.variableDeclaration.initializer,
                false);
            } else {
                throw new Error('Method not implemented.');
            }

            this.writer.writeStringNewLine(')');
            this.processStatement(node.catchClause.block);
        }

        if (node.finallyBlock) {
            throw new Error('Method not implemented.');
        }
    }

    private processThrowStatement(node: ts.ThrowStatement): void {
        this.writer.writeString('throw');
        if (node.expression) {
            this.writer.writeString(' ');
            this.processExpression(node.expression);
        }
    }

    private processTypeOfExpression(node: ts.TypeOfExpression): void {
        this.writer.writeString('typeof(');
        this.processExpression(node.expression);
        this.writer.writeString(')');
    }

    private processDebuggerStatement(node: ts.DebuggerStatement): void {
        this.writer.writeString('__asm { int 3 }');
    }

    private processEnumDeclaration(node: ts.EnumDeclaration): void {
        const properties = [];
        let value = 0;
        for (const member of node.members) {
            if (member.initializer) {
                switch (member.initializer.kind) {
                    case ts.SyntaxKind.NumericLiteral:
                        value = parseInt((<ts.NumericLiteral>member.initializer).text, 10);
                        break;
                    default:
                        throw new Error('Not Implemented');
                }
            } else {
                value++;
            }

            const namedProperty = ts.createPropertyAssignment(
                member.name,
                ts.createNumericLiteral(value.toString()));

            const valueProperty = ts.createPropertyAssignment(
                ts.createNumericLiteral(value.toString()),
                ts.createStringLiteral((<ts.Identifier>member.name).text));

            properties.push(namedProperty);
            properties.push(valueProperty);
        }

        const enumLiteralObject = ts.createObjectLiteral(properties);
        const varDecl = ts.createVariableDeclaration(node.name, undefined, enumLiteralObject);
        const enumDeclare = ts.createVariableStatement([], [varDecl]);

        (<any>varDecl).__declaration = true;

        this.processStatement(this.fixupParentReferences(enumDeclare, node));
    }

    private processClassDeclaration(node: ts.ClassDeclaration): void {
        throw new Error('Method not implemented.');
    }

    private processModuleDeclaration(node: ts.ModuleDeclaration): void {
        this.processStatement(<ts.ModuleBlock>node.body);
    }

    private processNamespaceDeclaration(node: ts.NamespaceDeclaration): void {
        this.processModuleDeclaration(node);
    }

    private processExportDeclaration(node: ts.ExportDeclaration): void {
        this.processTSNode(node);
    }

    private processImportDeclaration(node: ts.ImportDeclaration): void {
        throw new Error('Method not implemented.');
    }

    private isAlreadyDeclaredInGlobalScope(name: string) {
        return (<any>this.scope).declaredVars && (<any>this.scope).declaredVars.indexOf(name) >= 0;
    }

    private addToDeclaredInGlobalScope(name: string) {
        if (!(<any>this.scope).declaredVars) {
            (<any>this.scope).declaredVars = [];
        }

        return (<any>this.scope).declaredVars.push(name);
    }

    private isAlreadyDeclared(name: string) {
        const currentScope = (<any>this.scope[this.scope.length - 1]);
        return currentScope.declaredVars
            && currentScope.declaredVars.indexOf(name) >= 0;
    }

    private addToDeclared(name: string) {
        const currentScope = (<any>this.scope[this.scope.length - 1]);
        if (!(currentScope).declaredVars) {
            (currentScope).declaredVars = [];
        }

        return currentScope.declaredVars.push(name);
    }

    private processVariableDeclarationList(declarationList: ts.VariableDeclarationList, isExport?: boolean): void {

        if (this.isGlobalScope
            && declarationList.declarations.every(d => this.isAlreadyDeclaredInGlobalScope((<ts.Identifier>d.name).text))) {
            // escape if already declared;
            return;
        }

        // write declaration
        const isLocal = Helpers.isConstOrLet(declarationList);
        const declareType = this.isGlobalScope && !isLocal || !this.isGlobalScope && isLocal;
        if (!(<any>declarationList).__ignore_type && declareType) {
            this.writer.writeString('any ');
        }

        const next = false;
        declarationList.declarations.forEach(
            d => this.processVariableDeclarationOne(
                <ts.Identifier>d.name, d.initializer, next, isExport, (<any>d).__declaration));
    }

    private processVariableDeclarationOne(
        name: ts.Identifier, initializer: ts.Expression, next: boolean, isExport?: boolean, isDeclaration?: boolean) {
        if (next) {
            this.writer.writeStringNewLine(',');
        }

        this.writer.writeString(name.text);
        this.addToDeclaredInGlobalScope(name.text);

        if (initializer) {
            if (!this.isGlobalScope)
            {
                this.writer.writeString(' = ');
                this.processExpression(initializer);
            }
            else if (isDeclaration)
            {
                this.writer.writeString('(');
                this.processExpression(initializer);
                this.writer.writeString(')');
            }
        }

        next = true;
    }

    private processVariableStatement(node: ts.VariableStatement): void {
        const isExport = node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
        this.processVariableDeclarationList(node.declarationList, isExport);
        this.writer.EndOfStatement();
    }

    private processFunctionExpression(node: ts.FunctionExpression): void {

        const isLambdaFunction = node.kind === ts.SyntaxKind.FunctionExpression
                                 || node.kind === ts.SyntaxKind.ArrowFunction;
        if (isLambdaFunction) {
            // lambda
            this.writer.writeString('(functionType)[]');
        } else {
            // named function
            this.writer.writeString('auto ');
            this.processExpression(node.name);
        }

        this.writer.writeString('(');
        let next = false;
        node.parameters.forEach(element => {
            if (next) {
                this.writer.writeStringNewLine(',');
            }

            this.writer.writeString('any ');
            if (element.name.kind === ts.SyntaxKind.Identifier) {
                this.processExpression(element.name);
            } else {
                throw new Error('Not implemented');
            }

            next = true;
        });

        this.writer.writeString(')');
        this.processStatement(node.body);

        // formatting
        if (isLambdaFunction) {
            this.writer.cancelNewLine();
        }
    }

    private processArrowFunction(node: ts.ArrowFunction): void {
        if (node.body.kind !== ts.SyntaxKind.Block) {
            // create body
            node.body = ts.createBlock([ts.createReturn(<ts.Expression>node.body)]);
        }

        this.processFunctionExpression(<any>node);
    }

    private processFunctionDeclaration(node: ts.FunctionDeclaration): void {
        if (node.modifiers && node.modifiers.some(m => m.kind === ts.SyntaxKind.DeclareKeyword)) {
            // skip it, as it is only declaration
            return;
        }

        this.processFunctionExpression(<ts.FunctionExpression><any>node);
    }

    private processReturnStatement(node: ts.ReturnStatement): void {
        this.writer.writeString('return');
        if (node.expression) {
            this.writer.writeString(' ');
            this.processExpression(node.expression);
        }

        this.writer.EndOfStatement();
    }

    private processIfStatement(node: ts.IfStatement): void {
        this.writer.writeString('if ');

        this.writer.writeString('(');
        this.processExpression(node.expression);
        this.writer.writeString(') ');

        this.processStatement(node.thenStatement);

        if (node.elseStatement) {
            this.writer.writeString('else ');
            this.processStatement(node.elseStatement);
        }
    }

    private processDoStatement(node: ts.DoStatement): void {
        this.writer.writeStringNewLine('do');
        this.processStatement(node.statement);
        this.writer.writeString('while (');
        this.processExpression(node.expression);
        this.writer.writeStringNewLine(');');
    }

    private processWhileStatement(node: ts.WhileStatement): void {
        this.writer.writeString('while (');
        this.processExpression(node.expression);
        this.writer.writeStringNewLine(')');
        this.processStatement(node.statement);
    }

    private processForStatement(node: ts.ForStatement): void {
        this.writer.writeString('for (');
        const initVar = <any>node.initializer;
        initVar.__ignore_type = true;
        this.processExpression(initVar);
        this.writer.writeString('; ');
        this.processExpression(node.condition);
        this.writer.writeString('; ');
        this.processExpression(node.incrementor);
        this.writer.writeStringNewLine(')');
        this.processStatement(node.statement);
    }

    private processForInStatement(node: ts.ForInStatement): void {
        this.processForInStatementNoScope(node);
    }

    private processForInStatementNoScope(node: ts.ForInStatement): void {
        this.writer.writeString('for (auto& ');
        const initVar = <any>node.initializer;
        initVar.__ignore_type = true;
        this.processExpression(initVar);
        this.writer.writeString(' : ');
        this.processExpression(node.expression);
        this.writer.writeStringNewLine('.keys())');
        this.processStatement(node.statement);
    }

    private processForOfStatement(node: ts.ForOfStatement): void {
        this.writer.writeString('for (auto& ');
        const initVar = <any>node.initializer;
        initVar.__ignore_type = true;
        this.processExpression(initVar);
        this.writer.writeString(' : ');
        this.processExpression(node.expression);
        this.writer.writeStringNewLine(')');
        this.processStatement(node.statement);
    }

    private processBreakStatement(node: ts.BreakStatement) {
        this.writer.writeStringNewLine('break;');
    }

    private processContinueStatement(node: ts.ContinueStatement) {
        this.writer.writeStringNewLine('continue;');
    }

    private processSwitchStatement(node: ts.SwitchStatement) {
        this.writer.writeString('switch ((int)');
        this.processExpression(node.expression);
        this.writer.writeStringNewLine(')');

        this.writer.BeginBlock();

        node.caseBlock.clauses.forEach(element => {
            this.writer.DecreaseIntent();
            if (element.kind === ts.SyntaxKind.CaseClause) {
                this.writer.writeString('case ');
                this.processExpression(element.expression);
            } else {
                this.writer.writeString('default');
            }

            this.writer.IncreaseIntent();

            this.writer.writeStringNewLine(':');
            element.statements.forEach(elementCase => {
                this.processStatement(elementCase);
            });
        });

        this.writer.EndBlock();
    }

    private processBlock(node: ts.Block): void {
        this.writer.BeginBlock();

        node.statements.forEach(element => {
            this.processStatement(element);
        });

        this.writer.EndBlock();
    }

    private processModuleBlock(node: ts.ModuleBlock): void {
        node.statements.forEach(s => {
            this.processStatement(s);
        });
    }

    private processBooleanLiteral(node: ts.BooleanLiteral): void {
        this.writer.writeString(node.kind === ts.SyntaxKind.TrueKeyword ? 'true' : 'false');
    }

    private processNullLiteral(node: ts.NullLiteral): void {
        this.writer.writeString('nullptr');
    }

    private processNumericLiteral(node: ts.NumericLiteral): void {
        this.writer.writeString(node.text);
    }

    private processStringLiteral(node: ts.StringLiteral): void {
        this.writer.writeString(`"${node.text}"`);
    }

    private processNoSubstitutionTemplateLiteral(node: ts.NoSubstitutionTemplateLiteral): void {
        this.processStringLiteral(<ts.StringLiteral><any>node);
    }

    private processTemplateExpression(node: ts.TemplateExpression): void {
        this.processTSNode(node);
    }

    private processRegularExpressionLiteral(node: ts.RegularExpressionLiteral): void {
        throw new Error('Method not implemented.');
    }

    private processObjectLiteralExpression(node: ts.ObjectLiteralExpression): void {
        let next = false;

        if (node.properties.length === 0) {
            this.writer.writeString('any(anyTypeId::object)');
        } else {
            this.writer.BeginBlock();
            node.properties.forEach(element => {
                if (next) {
                    this.writer.writeStringNewLine(', ');
                }

                const property = <ts.PropertyAssignment>element;

                this.writer.writeString('std::make_tuple(');

                if (property.name.kind === ts.SyntaxKind.Identifier) {
                    this.processExpression(ts.createStringLiteral(property.name.text));
                } else {
                    this.processExpression(<ts.Expression>property.name);
                }

                this.writer.writeString(', ');
                this.processExpression(property.initializer);
                this.writer.writeString(')');

                next = true;
            });

            this.writer.EndBlock(true);
        }
    }

    private processArrayLiteralExpression(node: ts.ArrayLiteralExpression): void {
        let next = false;

        if (node.elements.length === 0) {
            this.writer.writeString('any(anyTypeId::array)');
        } else {
            this.writer.BeginBlockNoIntent();
            node.elements.forEach(element => {
                if (next) {
                    this.writer.writeString(', ');
                }

                this.processExpression(element);
                next = true;
            });

            this.writer.EndBlockNoIntent();
        }
    }

    private processElementAccessExpression(node: ts.ElementAccessExpression): void {
        this.processExpression(node.expression);
        this.writer.writeString('[');
        this.processExpression(node.argumentExpression);
        this.writer.writeString(']');
    }

    private processParenthesizedExpression(node: ts.ParenthesizedExpression) {
        this.writer.writeString('(');
        this.processExpression(node.expression);
        this.writer.writeString(')');
    }

    private processTypeAssertionExpression(node: ts.TypeAssertion) {
        this.processExpression(node.expression);
    }

    private processPrefixUnaryExpression(node: ts.PrefixUnaryExpression): void {
        this.writer.writeString(this.opsMap[node.operator]);
        this.processExpression(node.operand);
    }

    private processPostfixUnaryExpression(node: ts.PostfixUnaryExpression): void {
        this.processExpression(node.operand);
        this.writer.writeString(this.opsMap[node.operator]);
    }

    private processConditionalExpression(node: ts.ConditionalExpression): void {
        this.writer.writeString('(');
        this.processExpression(node.condition);
        this.writer.writeString(') ');
        this.processExpression(node.whenTrue);
        this.writer.writeString(' ? ');
        this.processExpression(node.whenFalse);
    }

    private processBinaryExpression(node: ts.BinaryExpression): void {
        const op = this.opsMap[node.operatorToken.kind];
        const isFunction = op.substr(0, 2) === '__';
        if (isFunction) {
            this.writer.writeString(op + '(');
        }

        this.processExpression(node.left);

        if (isFunction) {
            this.writer.writeString(', ');
        } else {
            this.writer.writeString(' ' + op + ' ');
        }

        this.processExpression(node.right);

        if (isFunction) {
            this.writer.writeString(')');
        }
    }

    private processDeleteExpression(node: ts.DeleteExpression): void {
        if (node.expression.kind === ts.SyntaxKind.PropertyAccessExpression) {
            const propertyAccess = <ts.PropertyAccessExpression>node.expression;
            this.processExpression(propertyAccess.expression);
            this.writer.writeString('.delete(');
            this.writer.writeString('("');
            this.processExpression(propertyAccess.name);
            this.writer.writeString('")');
        } else {
            throw new Error('Method not implemented.');
        }
    }

    private processNewExpression(node: ts.NewExpression): void {
        throw new Error('Method not implemented.');
    }

    private processCallExpression(node: ts.CallExpression): void {
        this.processExpression(node.expression);
        this.writer.writeString('(');

        let next = false;
        node.arguments.forEach(element => {
            if (next) {
                this.writer.writeString(', ');
            }

            this.processExpression(element);
            next = true;
        });
        this.writer.writeString(')');
    }

    private processThisExpression(node: ts.ThisExpression): void {
        this.writer.writeString('this');
    }

    private processSuperExpression(node: ts.SuperExpression): void {
        this.writer.writeString('__super');
    }

    private processVoidExpression(node: ts.VoidExpression): void {
        this.writer.writeString('void(');
        this.writer.writeString('(');
        this.processExpression(node.expression);
        this.writer.writeString(')');
    }

    private processNonNullExpression(node: ts.NonNullExpression): void {
        this.processExpression(node.expression);
    }

    private processAsExpression(node: ts.AsExpression): void {
        this.processExpression(node.expression);
    }

    private processSpreadElement(node: ts.SpreadElement): void {
        this.writer.writeString('...');
        this.processExpression(node.expression);
    }

    private processAwaitExpression(node: ts.AwaitExpression): void {
        throw new Error('Method not implemented.');
    }

    private processIndentifier(node: ts.Identifier): void {
        this.writer.writeString(node.text);
    }

    private isAnyLikeType(typeInfo: ts.Type) {
        return ((<ts.ObjectType>typeInfo).objectFlags & ts.ObjectFlags.Anonymous) === ts.ObjectFlags.Anonymous;
    }

    private processPropertyAccessExpression(node: ts.PropertyAccessExpression): void {

        const typeInfo = this.resolver.getTypeOf(node.expression);

        this.processExpression(node.expression);

        if (this.isAnyLikeType(typeInfo)) {
            this.writer.writeString('["');
            this.processExpression(node.name);
            this.writer.writeString('"]');
        } else {
            // member access when type is known
            this.writer.writeString('.');
            this.processExpression(node.name);
        }
    }
}

