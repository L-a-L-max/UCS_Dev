from setuptools import setup, find_packages

package_name = 'uav_telemetry_gateway'

setup(
    name=package_name,
    version='1.0.0',
    packages=find_packages(),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch', ['launch/gateway.launch.py']),
    ],
    install_requires=['setuptools', 'requests'],
    zip_safe=True,
    maintainer='UCS Team',
    maintainer_email='ucs@example.com',
    description='ROS 2 Gateway for UAV Telemetry to Java Backend',
    license='MIT',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'gateway_node = uav_telemetry_gateway.gateway_node:main',
        ],
    },
)
