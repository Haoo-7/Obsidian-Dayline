export class OverlayRegistry<Container extends object, Owner extends object> {
  private readonly owners = new Map<Container, Set<Owner>>();

  claim(container: Container, owner: Owner): void {
    let owners = this.owners.get(container);
    if (!owners) {
      owners = new Set<Owner>();
      this.owners.set(container, owners);
    }
    owners.add(owner);
  }

  release(container: Container, owner: Owner): boolean {
    const owners = this.owners.get(container);
    if (!owners) return true;
    owners.delete(owner);
    if (owners.size > 0) return false;
    this.owners.delete(container);
    return true;
  }

  clear(): Container[] {
    const containers = Array.from(this.owners.keys());
    this.owners.clear();
    return containers;
  }
}
