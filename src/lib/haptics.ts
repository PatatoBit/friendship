import { WebHaptics, type HapticInput, type TriggerOptions } from 'web-haptics';

let instance: WebHaptics | null = null;

function getHaptics() {
	if (typeof window === 'undefined') return null;
	instance ??= new WebHaptics();
	return instance;
}

/** Fire a brief haptic. No-ops on unsupported devices / SSR. */
export function haptic(input: HapticInput = 'medium', options?: TriggerOptions) {
	void getHaptics()?.trigger(input, options);
}
