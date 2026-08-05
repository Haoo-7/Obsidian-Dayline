export function hasExistingImage(embed: Pick<Element, 'querySelector'>): boolean {
  return embed.querySelector('img') !== null;
}
