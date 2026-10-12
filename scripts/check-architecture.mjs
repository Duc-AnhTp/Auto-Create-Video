import ts from 'typescript';
import {readdirSync,readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,relative,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const slash=value=>value.replaceAll('\\','/');
function files(folder){return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(folder,entry.name)):/\.tsx?$/.test(entry.name)?[join(folder,entry.name)]:[]);}
function resolveModule(file,spec){if(!spec?.startsWith('.'))return;const base=resolve(dirname(file),spec).replace(/\.js$/,'');return [base,base+'.ts',base+'.tsx',join(base,'index.ts')].find(path=>existsSync(path)&&statSync(path).isFile());}
function exportedOrigin(file,symbol,visited=new Set()){
 const key=file+':'+symbol;if(visited.has(key))return;visited.add(key);
 const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 for(const node of ast.statements){
  if(ts.isExportDeclaration(node)&&!node.isTypeOnly){
   const destination=resolveModule(file,node.moduleSpecifier?.text);
   if(node.exportClause&&ts.isNamedExports(node.exportClause))for(const binding of node.exportClause.elements){if(binding.isTypeOnly||binding.name.text!==symbol)continue;const original=binding.propertyName?.text??symbol;if(destination)return exportedOrigin(destination,original,visited)??destination;
    for(const imported of ast.statements){if(!ts.isImportDeclaration(imported)||imported.importClause?.isTypeOnly||!imported.importClause?.namedBindings||!ts.isNamedImports(imported.importClause.namedBindings))continue;const name=imported.importClause.namedBindings.elements.find(entry=>!entry.isTypeOnly&&entry.name.text===original);if(name){const source=resolveModule(file,imported.moduleSpecifier.text);if(source)return exportedOrigin(source,name.propertyName?.text??name.name.text,visited)??source;}}
   }else if(!node.exportClause&&destination){const origin=exportedOrigin(destination,symbol,visited);if(origin)return origin;}
  }
  if((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node))&&node.name?.text===symbol&&node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword))return file;
  if(ts.isVariableStatement(node)&&node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword)&&node.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text===symbol))return file;
 }
}
export function checkArchitecture(root=resolve(import.meta.dirname,'..')) {
 const sources=[...files(join(root,'src')),...files(join(root,'studio'))].filter(file=>!/(\.test\.|__test-utils__|test-setup)/.test(slash(file)));
 const graph=new Map(sources.map(file=>[file,new Set()])),diagnostics=[];
 const report=(file,node,ast,message)=>diagnostics.push({file:slash(relative(root,file)),line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,message});
 for(const file of sources){
  const name=slash(relative(root,file)),ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  function visit(node){
   let spec,typeOnly=false;
   if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
    spec=node.moduleSpecifier?.text;
    typeOnly=ts.isImportDeclaration(node)?Boolean(node.importClause?.isTypeOnly||(node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)&&node.importClause.namedBindings.elements.length>0&&node.importClause.namedBindings.elements.every(binding=>binding.isTypeOnly))):Boolean(node.isTypeOnly||(node.exportClause&&ts.isNamedExports(node.exportClause)&&node.exportClause.elements.length>0&&node.exportClause.elements.every(binding=>binding.isTypeOnly)));
   }else if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal)){spec=node.argument.literal.text;typeOnly=true;}else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0]))spec=node.arguments[0].text;
   if(spec){
    let destination;
    if(spec.startsWith('.')){const base=resolve(dirname(file),spec).replace(/\.js$/,'');destination=[base,base+'.ts',base+'.tsx',join(base,'index.ts')].find(path=>existsSync(path)&&statSync(path).isFile());}
    const dest=destination?slash(relative(root,destination)):spec;
    const owner=name.match(/^src\/modules\/([^/]+)/)?.[1],other=dest.match(/^src\/modules\/([^/]+)/)?.[1];
    if(name.startsWith('src/apps/')&&other&&dest!==`src/modules/${other}/index.ts`)report(file,node,ast,'Entrypoints must use the module public API: '+dest);
    if(owner&&other&&owner!==other&&dest!==`src/modules/${other}/index.ts`)report(file,node,ast,'Cross-module import must use the public index: '+dest);
    if(owner&&['story','media'].includes(owner)&&other==='production')report(file,node,ast,'Story/media must not depend on production');
    if(owner&&/^(src\/apps|src\/bootstrap)/.test(dest))report(file,node,ast,'Business modules must not depend on application wiring: '+dest);
    if(name.startsWith('studio/')&&dest.startsWith('src/')&&!dest.startsWith('src/contracts/'))report(file,node,ast,'Studio may only consume backend DTO/schema contracts');
    if(name.startsWith('src/contracts/')&&destination&&!dest.startsWith('src/contracts/'))report(file,node,ast,'Contracts must not depend on backend implementations');
    if(name.startsWith('src/platform/')&&/^(src\/modules|src\/apps|src\/bootstrap)/.test(dest))report(file,node,ast,'Platform must remain independent of application modules');
    if(name.includes('/domain/')&&(!typeOnly&&(/(\/adapters\/|\/application\/|src\/bootstrap\/|src\/apps\/|platform\/observability)/.test(dest)||/^(node:(fs|http|https|sqlite|child_process)|axios|react|dotenv)/.test(spec))))report(file,node,ast,'Domain must remain free of I/O and implementation dependencies');
    if(name.match(/^src\/modules\/[^/]+\/index.ts$/)&&ts.isExportDeclaration(node)&&!typeOnly){
     if(dest.includes('/adapters/'))report(file,node,ast,'Public API must not re-export concrete adapters');
     else if(destination&&node.exportClause&&ts.isNamedExports(node.exportClause))for(const binding of node.exportClause.elements){if(binding.isTypeOnly)continue;const origin=exportedOrigin(destination,binding.propertyName?.text??binding.name.text);if(origin&&slash(origin).includes('/adapters/'))report(file,node,ast,'Public API must not indirectly re-export concrete adapters: '+binding.name.text);}
    }
    if(!typeOnly&&destination&&graph.has(destination))graph.get(file).add(destination);
   }
   if(name.includes('/domain/')&&ts.isPropertyAccessExpression(node)&&node.expression.getText(ast)==='process'&&node.name.text==='env')report(file,node,ast,'Domain must not read environment variables');
   ts.forEachChild(node,visit);
  }
  visit(ast);
 }
 const active=new Set(),seen=new Set(),stack=[];
 function visit(file){if(active.has(file)){diagnostics.push({file:slash(relative(root,file)),line:1,message:'Runtime import cycle: '+stack.slice(stack.indexOf(file)).concat(file).map(path=>slash(relative(root,path))).join(' -> ')});return;}if(seen.has(file))return;seen.add(file);active.add(file);stack.push(file);for(const destination of graph.get(file))visit(destination);stack.pop();active.delete(file);}
 for(const file of sources)visit(file);
 return {files:sources.length,edges:[...graph.values()].reduce((count,edges)=>count+edges.size,0),diagnostics};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=checkArchitecture();for(const diagnostic of result.diagnostics)console.error(diagnostic.file+':'+diagnostic.line+' '+diagnostic.message);
 console.log('Architecture: '+result.files+' files, '+result.edges+' runtime edges, '+result.diagnostics.length+' violations');process.exitCode=result.diagnostics.length?1:0;
}
