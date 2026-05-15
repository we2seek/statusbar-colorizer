export interface ContrastChecker {
  getForeground(backgroundColor: string): '#000000' | '#FFFFFF';
  getLuminance(hexColor: string): number; // [0, 1]
  getContrastRatio(hex1: string, hex2: string): number; // >= 1
}

export class ContrastCheckerImpl implements ContrastChecker {
  /**
   * Computes the WCAG 2.1 relative luminance of a hex color.
   * @param hexColor - A color in #RRGGBB format
   * @returns Relative luminance in [0, 1]
   */
  getLuminance(hexColor: string): number {
    const hex = hexColor.replace(/^#/, '');
    const r8 = parseInt(hex.substring(0, 2), 16);
    const g8 = parseInt(hex.substring(2, 4), 16);
    const b8 = parseInt(hex.substring(4, 6), 16);

    const linearize = (c8bit: number): number => {
      const csrgb = c8bit / 255;
      if (csrgb <= 0.03928) {
        return csrgb / 12.92;
      }
      return Math.pow((csrgb + 0.055) / 1.055, 2.4);
    };

    const R = linearize(r8);
    const G = linearize(g8);
    const B = linearize(b8);

    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  /**
   * Computes the WCAG 2.1 contrast ratio between two hex colors.
   * @param hex1 - First color in #RRGGBB format
   * @param hex2 - Second color in #RRGGBB format
   * @returns Contrast ratio >= 1
   */
  getContrastRatio(hex1: string, hex2: string): number {
    const lum1 = this.getLuminance(hex1);
    const lum2 = this.getLuminance(hex2);
    const L1 = Math.max(lum1, lum2);
    const L2 = Math.min(lum1, lum2);
    return (L1 + 0.05) / (L2 + 0.05);
  }

  /**
   * Returns the foreground color (#000000 or #FFFFFF) that provides
   * sufficient contrast against the given background color.
   * @param backgroundColor - Background color in #RRGGBB format
   * @returns '#000000' if luminance > 0.179, '#FFFFFF' otherwise
   */
  getForeground(backgroundColor: string): '#000000' | '#FFFFFF' {
    const luminance = this.getLuminance(backgroundColor);
    return luminance > 0.179 ? '#000000' : '#FFFFFF';
  }
}
