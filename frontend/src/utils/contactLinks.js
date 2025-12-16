const digitsOnly = (value) => {
  if (typeof value !== 'string') {
    value = value || '';
  }
  return value.replace(/\D+/g, '');
};

export const CONTACT_LINK_CLASSES = 'inline-flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-md text-purple-100 underline decoration-purple-400/60 decoration-2 underline-offset-4 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-300 transition';

export const formatPhoneHref = (value, defaultCountry = '+1') => {
  const digits = digitsOnly(value);
  if (!digits) {
    return null;
  }
  let normalized = digits;
  if (digits.length === 11 && digits.startsWith('1')) {
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    normalized = `${defaultCountry}${digits}`;
  } else if (!digits.startsWith('+')) {
    normalized = `+${digits}`;
  } else {
    normalized = digits;
  }
  return `tel:${normalized}`;
};
