interface Foo { readonly a: string }
const f: Foo = { a: 'ok' };
enum Local { X = 1 }
console.log(f.a, Local.X);
