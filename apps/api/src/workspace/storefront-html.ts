export const escape = (value: string) =>
  value.replace(/[&<>"']/gu, (char) => {
    return (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        char
      ] ?? char
    );
  });
