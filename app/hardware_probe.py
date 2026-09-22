"""Local SAM hardware discovery and device policy. Never reads credentials."""
import json
import os
import platform


def resolve_device(torch, requested=None):
    choice = (os.environ.get('SAM2_DEVICE', 'auto') if requested is None else requested).strip().lower()
    if choice not in ('auto', 'cpu', 'cuda'):
        raise ValueError('Choose Auto, CPU, or NVIDIA GPU for object selection.')
    available = bool(torch.cuda.is_available())
    if choice == 'cuda' and not available:
        raise RuntimeError('NVIDIA GPU processing is unavailable. Install CUDA-enabled PyTorch and a compatible NVIDIA driver, or choose CPU in Settings.')
    return 'cuda' if choice == 'cuda' or (choice == 'auto' and available) else 'cpu'


def configure_threads(torch):
    # Avoid oversubscribing desktop CPUs while leaving capacity for the editor.
    count = max(1, min(4, (os.cpu_count() or 2) // 2, torch.get_num_threads()))
    torch.set_num_threads(count)
    return count


def probe(torch_module=None):
    result = {'cpu': {'name': platform.processor() or platform.machine(), 'logicalCores': os.cpu_count() or 1},
              'torchAvailable': False, 'cudaAvailable': False, 'gpus': [],
              'requestedDevice': os.environ.get('SAM2_DEVICE', 'auto'), 'resolvedDevice': 'cpu'}
    try:
        if torch_module is None:
            import torch as torch_module
        result['torchAvailable'] = True
        result['torchVersion'] = str(torch_module.__version__)
        result['cudaAvailable'] = bool(torch_module.cuda.is_available())
        if result['cudaAvailable']:
            for index in range(torch_module.cuda.device_count()):
                props = torch_module.cuda.get_device_properties(index)
                result['gpus'].append({'index': index, 'name': props.name, 'memoryBytes': props.total_memory})
        result['resolvedDevice'] = resolve_device(torch_module)
    except ImportError:
        result['error'] = 'Object-selection runtime is not installed.'
    except Exception as error:
        result['error'] = str(error)
        result['resolvedDevice'] = None
    return result


if __name__ == '__main__':
    print(json.dumps(probe()))
