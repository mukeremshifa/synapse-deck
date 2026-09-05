interface Foo { readonly a: string }
type B = Foo | null;
const f: Foo = { a: 'ok' };
const g = f as Foo;
const h: B = null;
console.log(g.a, h === null ? 'null-ok' : 'x');
