import os
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from hardware_probe import resolve_device, configure_threads, probe


def fake_torch(available=False):
    return SimpleNamespace(__version__='test', cuda=SimpleNamespace(
        is_available=lambda: available, device_count=lambda: 1,
        get_device_properties=lambda index: SimpleNamespace(name='Test GPU', total_memory=4*1024**3)),
        get_num_threads=lambda: 64, set_num_threads=Mock())


class HardwareTests(unittest.TestCase):
    def test_auto_uses_gpu_when_available(self):
        self.assertEqual(resolve_device(fake_torch(True), 'auto'), 'cuda')
        self.assertEqual(resolve_device(fake_torch(), 'auto'), 'cpu')

    def test_explicit_cpu_honored(self):
        self.assertEqual(resolve_device(fake_torch(True), 'cpu'), 'cpu')

    def test_missing_gpu_has_actionable_error(self):
        with self.assertRaisesRegex(RuntimeError, 'choose CPU'):
            resolve_device(fake_torch(), 'cuda')

    def test_invalid_device_rejected(self):
        with self.assertRaises(ValueError): resolve_device(fake_torch(), 'other')

    def test_environment_preference(self):
        with patch.dict(os.environ, {'SAM2_DEVICE': 'cpu'}):
            self.assertEqual(resolve_device(fake_torch(True)), 'cpu')

    def test_probe_reports_memory(self):
        with patch.dict(os.environ, {'SAM2_DEVICE': 'auto'}):
            data = probe(fake_torch(True))
        self.assertEqual(data['gpus'][0]['memoryBytes'], 4*1024**3)
        self.assertEqual(data['resolvedDevice'], 'cuda')

    def test_probe_invalid_preference_not_silent_fallback(self):
        with patch.dict(os.environ, {'SAM2_DEVICE': 'cuda'}):
            data = probe(fake_torch())
        self.assertIsNone(data['resolvedDevice'])
        self.assertIn('choose CPU', data['error'])

    def test_threads_bounded(self):
        model = fake_torch()
        with patch('os.cpu_count', return_value=16):
            self.assertEqual(configure_threads(model), 4)
        model.set_num_threads.assert_called_once_with(4)

if __name__ == '__main__': unittest.main()
