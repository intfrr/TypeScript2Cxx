class Animal {
    protected constructor(public numLegs: number) {
    }
}

class Bee extends Animal {
    public constructor() {
        super(1);
    }
}

class Lion extends Animal {
    public constructor() {
        super(2);
    }
}

function createInstance<A extends Animal>(c: new () => A): A {
    return new c();
}

console.log(createInstance(Lion).numLegs);
console.log(createInstance(Bee).numLegs);
