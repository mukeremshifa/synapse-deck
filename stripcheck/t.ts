interface Foo { readonly a: string }
const f: Foo = { a: 'ok' };
enum E { X }
console.log(f.a, E.X);
